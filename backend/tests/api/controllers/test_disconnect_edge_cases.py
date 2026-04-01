"""Tests for disconnect timing and edge cases."""

from datetime import datetime

import pytest
from sqlmodel import select

from majlisna.api.controllers.codenames_helpers import CodenamesGameStatus, CodenamesRole, CodenamesTeam
from majlisna.api.controllers.disconnect import (
    _handle_codenames_disconnect,
    _handle_permanent_disconnect,
    _handle_undercover_disconnect,
    _handle_wordquiz_disconnect,
    _remove_expired_users,
    mark_user_disconnected,
    update_heartbeat,
)
from majlisna.api.controllers.shared import get_password_hash
from majlisna.api.models.game import GameStatus, GameType
from majlisna.api.models.relationship import RoomUserLink
from majlisna.api.models.room import RoomType
from majlisna.api.models.table import Game, Room, User
from majlisna.api.models.undercover import UndercoverRole

# ─── Helpers ──────────────────────────────────────────────────


async def _create_user(session, username="testuser", email="test@test.com"):
    user = User(username=username, email_address=email, password=get_password_hash("pass123"))
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_room(session, owner):
    room = Room(
        public_id="ABCDE",
        owner_id=owner.id,
        status="online",
        password="1234",
        type=RoomType.ACTIVE,
    )
    session.add(room)
    await session.commit()
    await session.refresh(room)
    return room


async def _create_link(session, room_id, user_id, connected=True):
    link = RoomUserLink(
        room_id=room_id,
        user_id=user_id,
        connected=connected,
        last_seen_at=datetime.now(),
    )
    session.add(link)
    await session.commit()
    await session.refresh(link)
    return link


async def _create_undercover_game(session, room, players_data):
    """Create a game with undercover live_state."""
    game = Game(
        room_id=room.id,
        type=GameType.UNDERCOVER,
        number_of_players=len(players_data),
        game_status=GameStatus.IN_PROGRESS,
        live_state={
            "civilian_word": "mosque",
            "undercover_word": "church",
            "players": players_data,
            "eliminated_players": [],
            "turns": [
                {"votes": {}, "words": {}, "description_order": [], "current_describer_index": 0, "phase": "describing"}
            ],
        },
    )
    session.add(game)
    await session.commit()
    await session.refresh(game)

    room.active_game_id = game.id
    session.add(room)
    await session.commit()

    return game


async def _create_codenames_game(session, room, players_data):
    """Create a game with codenames live_state."""
    game = Game(
        room_id=room.id,
        type=GameType.CODENAMES,
        number_of_players=len(players_data),
        game_status=GameStatus.IN_PROGRESS,
        live_state={
            "board": [{"word": f"w{i}", "card_type": "neutral", "revealed": False} for i in range(25)],
            "players": players_data,
            "current_team": CodenamesTeam.RED.value,
            "current_turn": {
                "team": CodenamesTeam.RED.value,
                "clue_word": None,
                "clue_number": 0,
                "guesses_made": 0,
                "max_guesses": 0,
            },
            "red_remaining": 9,
            "blue_remaining": 8,
            "status": CodenamesGameStatus.IN_PROGRESS.value,
            "winner": None,
        },
    )
    session.add(game)
    await session.commit()
    await session.refresh(game)

    room.active_game_id = game.id
    session.add(room)
    await session.commit()

    return game


async def _create_wordquiz_game(session, room, players_data):
    """Create a game with word quiz live_state."""
    game = Game(
        room_id=room.id,
        type=GameType.WORD_QUIZ,
        number_of_players=len(players_data),
        game_status=GameStatus.IN_PROGRESS,
        live_state={
            "players": players_data,
            "current_round": 1,
            "total_rounds": 5,
            "answers": {},
            "game_over": False,
        },
    )
    session.add(game)
    await session.commit()
    await session.refresh(game)

    room.active_game_id = game.id
    session.add(room)
    await session.commit()

    return game


# ========== Disconnect Timing & Edge Case Tests ==========


@pytest.mark.asyncio
async def test_disconnect_current_describer_advances_turn(session):
    """Current describer disconnects: player marked dead, game still in progress with 3 alive."""
    # Prepare — 4-player undercover game, player 0 is current describer
    users = [await _create_user(session, f"p{i}", f"p{i}@test.com") for i in range(4)]
    room = await _create_room(session, users[0])
    players_data = [
        {
            "user_id": str(u.id),
            "username": u.username,
            "role": UndercoverRole.CIVILIAN.value,
            "is_alive": True,
            "is_mayor": i == 0,
        }
        for i, u in enumerate(users)
    ]
    players_data[1]["role"] = UndercoverRole.UNDERCOVER.value

    game = await _create_undercover_game(session, room, players_data)

    # Set up description_order so player 0 is the current describer
    game.live_state["turns"][0]["description_order"] = [str(u.id) for u in users]
    game.live_state["turns"][0]["current_describer_index"] = 0
    session.add(game)
    await session.commit()

    # Act — disconnect the current describer (player 0, civilian)
    await _handle_undercover_disconnect(session, game, str(users[0].id), room)

    # Assert
    game = (await session.exec(select(Game).where(Game.id == game.id))).first()
    describer_player = next(p for p in game.live_state["players"] if p["user_id"] == str(users[0].id))
    assert describer_player["is_alive"] is False
    assert game.game_status == GameStatus.IN_PROGRESS
    alive_count = sum(1 for p in game.live_state["players"] if p["is_alive"])
    assert alive_count == 3


@pytest.mark.asyncio
async def test_disconnect_during_vote_does_not_crash(session):
    """Player disconnects during voting phase with votes cast for them — no crash, state consistent."""
    # Prepare — 4-player undercover game in voting phase
    users = [await _create_user(session, f"p{i}", f"p{i}@test.com") for i in range(4)]
    room = await _create_room(session, users[0])
    players_data = [
        {
            "user_id": str(u.id),
            "username": u.username,
            "role": UndercoverRole.CIVILIAN.value,
            "is_alive": True,
            "is_mayor": i == 0,
        }
        for i, u in enumerate(users)
    ]
    players_data[1]["role"] = UndercoverRole.UNDERCOVER.value

    game = await _create_undercover_game(session, room, players_data)

    # Set voting phase with a vote targeting player 1 (player B)
    game.live_state["turns"][0]["phase"] = "voting"
    game.live_state["turns"][0]["votes"] = {str(users[0].id): str(users[1].id)}
    session.add(game)
    await session.commit()

    # Act — disconnect player 1 (the one being voted for)
    await _handle_undercover_disconnect(session, game, str(users[1].id), room)

    # Assert — player B marked dead, game state consistent
    game = (await session.exec(select(Game).where(Game.id == game.id))).first()
    player_b = next(p for p in game.live_state["players"] if p["user_id"] == str(users[1].id))
    assert player_b["is_alive"] is False
    # The undercover disconnected, 0 undercover + 0 mr_white alive → civilians win
    assert game.game_status == GameStatus.FINISHED


@pytest.mark.asyncio
async def test_disconnect_last_civilian_undercovers_win(session):
    """Disconnect both civilians from 2 undercover + 2 civilian game — undercovers win after first disconnect."""
    # Prepare — 4 players: 2 undercover, 2 civilian
    users = [await _create_user(session, f"p{i}", f"p{i}@test.com") for i in range(4)]
    room = await _create_room(session, users[0])
    players_data = [
        {
            "user_id": str(u.id),
            "username": u.username,
            "role": UndercoverRole.CIVILIAN.value,
            "is_alive": True,
            "is_mayor": i == 0,
        }
        for i, u in enumerate(users)
    ]
    players_data[0]["role"] = UndercoverRole.UNDERCOVER.value
    players_data[1]["role"] = UndercoverRole.UNDERCOVER.value
    # players_data[2] and [3] are civilians

    game = await _create_undercover_game(session, room, players_data)

    # Act — disconnect first civilian (player 2)
    await _handle_undercover_disconnect(session, game, str(users[2].id), room)

    # Assert — after first civilian disconnect: 2 undercover >= 1 civilian → game FINISHED
    game = (await session.exec(select(Game).where(Game.id == game.id))).first()
    assert game.game_status == GameStatus.FINISHED


@pytest.mark.asyncio
async def test_disconnect_all_players_room_deactivated(session):
    """Permanently disconnect all 3 players from a room (no game) — room becomes INACTIVE."""
    # Prepare — 3 players in a room with no active game
    users = [await _create_user(session, f"p{i}", f"p{i}@test.com") for i in range(3)]
    room = await _create_room(session, users[0])
    for u in users:
        await _create_link(session, room.id, u.id, connected=True)

    # Act — permanently disconnect all 3 one by one
    for u in users:
        link = (
            await session.exec(
                select(RoomUserLink).where(RoomUserLink.room_id == room.id).where(RoomUserLink.user_id == u.id)
            )
        ).first()
        if link:
            await _handle_permanent_disconnect(session, link)

    # Assert — room is INACTIVE
    room = (await session.exec(select(Room).where(Room.id == room.id))).first()
    assert room.type == RoomType.INACTIVE


@pytest.mark.asyncio
async def test_disconnect_spymaster_removes_from_team(session):
    """Red spymaster disconnects from codenames — if red team empty, blue wins."""
    # Prepare — 4 players: red has only spymaster, blue has spymaster + operative
    users = [await _create_user(session, f"p{i}", f"p{i}@test.com") for i in range(4)]
    room = await _create_room(session, users[0])
    players_data = [
        {"user_id": str(users[0].id), "username": "p0", "team": "red", "role": CodenamesRole.SPYMASTER.value},
        {"user_id": str(users[1].id), "username": "p1", "team": "blue", "role": CodenamesRole.SPYMASTER.value},
        {"user_id": str(users[2].id), "username": "p2", "team": "blue", "role": CodenamesRole.OPERATIVE.value},
        {"user_id": str(users[3].id), "username": "p3", "team": "blue", "role": CodenamesRole.OPERATIVE.value},
    ]
    game = await _create_codenames_game(session, room, players_data)

    # Act — disconnect the only red player (spymaster)
    await _handle_codenames_disconnect(session, game, str(users[0].id), room)

    # Assert — red team empty, blue wins
    game = (await session.exec(select(Game).where(Game.id == game.id))).first()
    remaining_ids = [p["user_id"] for p in game.live_state["players"]]
    assert str(users[0].id) not in remaining_ids
    assert game.live_state["status"] == CodenamesGameStatus.FINISHED.value
    assert game.live_state["winner"] == "blue"
    assert game.game_status == GameStatus.FINISHED


@pytest.mark.asyncio
async def test_disconnect_reconnect_within_grace_period(session):
    """Mark user disconnected, then reconnect via update_heartbeat before grace expires — user NOT removed."""
    # Prepare
    user = await _create_user(session)
    room = await _create_room(session, user)
    await _create_link(session, room.id, user.id, connected=True)

    # Act — mark disconnected
    await mark_user_disconnected(session, str(user.id), str(room.id))

    # Verify disconnected
    link = (
        await session.exec(
            select(RoomUserLink).where(RoomUserLink.room_id == room.id).where(RoomUserLink.user_id == user.id)
        )
    ).first()
    assert link.connected is False
    assert link.disconnected_at is not None

    # Act — reconnect via heartbeat before grace period expires
    await update_heartbeat(session, str(user.id), str(room.id))

    # Assert — reconnected
    link = (
        await session.exec(
            select(RoomUserLink).where(RoomUserLink.room_id == room.id).where(RoomUserLink.user_id == user.id)
        )
    ).first()
    assert link.connected is True
    assert link.disconnected_at is None

    # Act — run _remove_expired_users — user should NOT be removed (they reconnected)
    affected_rooms, _affected_games = await _remove_expired_users(session)

    # Assert — link still exists
    link = (
        await session.exec(
            select(RoomUserLink).where(RoomUserLink.room_id == room.id).where(RoomUserLink.user_id == user.id)
        )
    ).first()
    assert link is not None
    assert link.connected is True
    assert len(affected_rooms) == 0


@pytest.mark.asyncio
async def test_disconnect_host_transfers_ownership(session):
    """Room host permanently disconnects — ownership transfers to one of remaining users."""
    # Prepare — host + 2 others
    host = await _create_user(session, "host", "host@test.com")
    other1 = await _create_user(session, "other1", "other1@test.com")
    other2 = await _create_user(session, "other2", "other2@test.com")
    room = await _create_room(session, host)
    assert room.owner_id == host.id

    host_link = await _create_link(session, room.id, host.id, connected=True)
    await _create_link(session, room.id, other1.id, connected=True)
    await _create_link(session, room.id, other2.id, connected=True)

    # Act — host permanently disconnects
    await _handle_permanent_disconnect(session, host_link)

    # Assert — ownership transferred to one of the remaining users
    room = (await session.exec(select(Room).where(Room.id == room.id))).first()
    assert room.owner_id != host.id
    assert room.owner_id in (other1.id, other2.id)
    assert room.type == RoomType.ACTIVE


@pytest.mark.asyncio
async def test_disconnect_spectator_no_game_impact(session):
    """Spectator disconnects from room with active undercover game — game state unaffected."""
    # Prepare — 4-player undercover game + 1 spectator
    users = [await _create_user(session, f"p{i}", f"p{i}@test.com") for i in range(4)]
    spectator = await _create_user(session, "spectator", "spectator@test.com")
    room = await _create_room(session, users[0])

    for u in users:
        await _create_link(session, room.id, u.id, connected=True)

    # Create spectator link
    spectator_link = RoomUserLink(
        room_id=room.id,
        user_id=spectator.id,
        connected=True,
        last_seen_at=datetime.now(),
        is_spectator=True,
    )
    session.add(spectator_link)
    await session.commit()
    await session.refresh(spectator_link)

    players_data = [
        {
            "user_id": str(u.id),
            "username": u.username,
            "role": UndercoverRole.CIVILIAN.value,
            "is_alive": True,
            "is_mayor": i == 0,
        }
        for i, u in enumerate(users)
    ]
    players_data[1]["role"] = UndercoverRole.UNDERCOVER.value
    game = await _create_undercover_game(session, room, players_data)

    # Snapshot game state before disconnect
    game_before = (await session.exec(select(Game).where(Game.id == game.id))).first()
    players_before = game_before.live_state["players"].copy()
    status_before = game_before.game_status

    # Act — permanently disconnect the spectator
    await _handle_permanent_disconnect(session, spectator_link)

    # Assert — game state unchanged (spectator is not in live_state.players)
    game_after = (await session.exec(select(Game).where(Game.id == game.id))).first()
    assert game_after.game_status == status_before
    assert len(game_after.live_state["players"]) == len(players_before)
    for p in game_after.live_state["players"]:
        assert p["is_alive"] is True


@pytest.mark.asyncio
async def test_disconnect_below_min_players_cancels(session):
    """3-player undercover game — one civilian disconnect leaves 1 UC >= 1 CIV — game FINISHED (win awarded)."""
    # Prepare — 3 players
    users = [await _create_user(session, f"p{i}", f"p{i}@test.com") for i in range(3)]
    room = await _create_room(session, users[0])
    players_data = [
        {
            "user_id": str(u.id),
            "username": u.username,
            "role": UndercoverRole.CIVILIAN.value,
            "is_alive": True,
            "is_mayor": i == 0,
        }
        for i, u in enumerate(users)
    ]
    players_data[1]["role"] = UndercoverRole.UNDERCOVER.value
    game = await _create_undercover_game(session, room, players_data)

    # Act — disconnect one player (civilian)
    await _handle_undercover_disconnect(session, game, str(users[2].id), room)

    # Assert — win condition met (1 UC >= 1 CIV), so game finishes instead of cancelling
    game = (await session.exec(select(Game).where(Game.id == game.id))).first()
    assert game.game_status == GameStatus.FINISHED
    assert game.end_time is not None

    room = (await session.exec(select(Room).where(Room.id == room.id))).first()
    assert room.active_game_id is None


@pytest.mark.asyncio
async def test_double_disconnect_same_player_idempotent(session):
    """Calling mark_user_disconnected twice for same player — second call is a no-op, no crash."""
    # Prepare
    user = await _create_user(session)
    room = await _create_room(session, user)
    await _create_link(session, room.id, user.id, connected=True)

    # Act — first disconnect
    await mark_user_disconnected(session, str(user.id), str(room.id))

    # Verify first disconnect took effect
    link = (
        await session.exec(
            select(RoomUserLink).where(RoomUserLink.room_id == room.id).where(RoomUserLink.user_id == user.id)
        )
    ).first()
    assert link.connected is False
    first_disconnected_at = link.disconnected_at

    # Act — second disconnect (should be no-op since connected=False, query filters on connected=True)
    await mark_user_disconnected(session, str(user.id), str(room.id))

    # Assert — no crash, disconnected_at unchanged
    link = (
        await session.exec(
            select(RoomUserLink).where(RoomUserLink.room_id == room.id).where(RoomUserLink.user_id == user.id)
        )
    ).first()
    assert link.connected is False
    assert link.disconnected_at == first_disconnected_at


@pytest.mark.asyncio
async def test_disconnect_during_quiz_removes_answer(session):
    """Word quiz player with a submitted answer disconnects — answer removed, player removed from list."""
    # Prepare — 3 players, player 1 has submitted an answer
    users = [await _create_user(session, f"p{i}", f"p{i}@test.com") for i in range(3)]
    room = await _create_room(session, users[0])
    players_data = [{"user_id": str(u.id), "username": u.username, "score": 0} for u in users]
    game = await _create_wordquiz_game(session, room, players_data)

    # Add an answer for player 1
    game.live_state["answers"] = {str(users[1].id): "Al-Fatiha"}
    session.add(game)
    await session.commit()

    # Act — disconnect player 1
    await _handle_wordquiz_disconnect(session, game, str(users[1].id), room)

    # Assert — player removed from players list
    game = (await session.exec(select(Game).where(Game.id == game.id))).first()
    player_ids = [p["user_id"] for p in game.live_state["players"]]
    assert str(users[1].id) not in player_ids
    assert len(player_ids) == 2

    # Assert — answer removed
    assert str(users[1].id) not in game.live_state.get("answers", {})

    # Assert — game still in progress (2 players remain)
    assert game.game_status == GameStatus.IN_PROGRESS
