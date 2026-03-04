"""Tests for concurrent mutations on Undercover game state via Redis locks.

Uses real Redis via testcontainers and asyncio.gather to submit concurrent operations.
Verifies that the unified Redis lock (game:{id}:state) correctly serializes mutations.
"""

import asyncio
from unittest.mock import AsyncMock, patch
from uuid import UUID

from ibg.api.models.undercover import UndercoverRole
from ibg.socketio.controllers.disconnect import handle_undercover_disconnect
from ibg.socketio.controllers.undercover_game import (
    eliminate_player_based_on_votes,
    set_vote,
    submit_description,
)
from ibg.socketio.models.shared import redis_connection
from ibg.socketio.models.socket import UndercoverGame, UndercoverTurn, VoteForAPerson
from tests.sockets.conftest import make_undercover_player

# Fixed UUIDs
P1 = "11111111-1111-1111-1111-111111111111"
P2 = "22222222-2222-2222-2222-222222222222"
P3 = "33333333-3333-3333-3333-333333333333"
P4 = "44444444-4444-4444-4444-444444444444"
P5 = "55555555-5555-5555-5555-555555555555"

ROOM_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
GAME_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


# ========== Concurrent votes ==========


async def test_concurrent_votes_no_double_elimination(make_undercover_game, make_redis_room):
    """Two players vote concurrently (both completing the vote set). Only ONE returns all_voted=True."""

    # Arrange — 4 players, 2 already voted (P1->P4, P2->P4)
    votes = {UUID(P1): P4, UUID(P2): P4}
    turn = UndercoverTurn(votes=votes, phase="voting")

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id=GAME_ID,
        room_id=ROOM_ID,
        players=[
            make_undercover_player(P1),
            make_undercover_player(P2),
            make_undercover_player(P3),
            make_undercover_player(P4),
        ],
        turns=[turn],
    )

    vote_p3 = VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P3, voted_user_id=P4)
    vote_p4 = VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P4, voted_user_id=P3)

    # Act — submit both votes concurrently
    results = await asyncio.gather(
        set_vote(game, vote_p3),
        set_vote(game, vote_p4),
    )

    # Assert — both succeed, exactly one returns all_voted=True
    all_voted_flags = [r[3] for r in results]
    assert all_voted_flags.count(True) == 1, "Exactly one concurrent vote should trigger all_voted"

    # Verify all 4 votes persisted in Redis
    refreshed = await UndercoverGame.get(GAME_ID)
    assert len(refreshed.turns[-1].votes) == 4

    # Now eliminate — should work cleanly with no corruption
    eliminated, count = await eliminate_player_based_on_votes(refreshed)
    assert eliminated is not None
    assert len(refreshed.eliminated_players) == 1


# ========== Concurrent descriptions ==========


async def test_concurrent_descriptions_serialized(make_undercover_game, make_redis_room):
    """Two concurrent submit_description calls wrapped in the same lock pattern are serialized.

    The lock prevents index corruption — both calls resolve without crash,
    and the game state (words dict + describer index) is consistent.
    """

    # Arrange — 2 players, P1 is first describer
    description_order = [UUID(P1), UUID(P2)]
    turn = UndercoverTurn(
        description_order=description_order,
        current_describer_index=0,
        phase="describing",
    )

    await make_redis_room(ROOM_ID)
    await make_undercover_game(
        game_id=GAME_ID,
        room_id=ROOM_ID,
        players=[
            make_undercover_player(P1),
            make_undercover_player(P2),
        ],
        turns=[turn],
    )

    async def submit_with_lock(user_id: str, word: str) -> bool:
        """Simulate the route-level pattern: acquire lock -> fetch -> mutate -> save."""
        async with redis_connection.lock(f"game:{GAME_ID}:state", timeout=5):
            fresh_game = await UndercoverGame.get(GAME_ID)
            all_done = submit_description(fresh_game, UUID(user_id), word)
            await fresh_game.save()
            return all_done

    # Act — submit both descriptions concurrently
    results = await asyncio.gather(
        submit_with_lock(P1, "prayer"),
        submit_with_lock(P2, "fasting"),
    )

    # Assert — both completed without crash
    assert len(results) == 2

    # Verify game state is consistent in Redis
    refreshed = await UndercoverGame.get(GAME_ID)
    assert len(refreshed.turns[-1].words) == 2
    assert refreshed.turns[-1].current_describer_index == 2

    # Exactly one should return all_done=True (the second one serialized by the lock)
    assert results.count(True) == 1


# ========== Vote + disconnect ==========


@patch("ibg.socketio.controllers.disconnect.send_event_to_client", new_callable=AsyncMock)
async def test_vote_and_disconnect_no_corruption(mock_send, make_undercover_game, make_redis_room):  # noqa: ARG001
    """A vote and a disconnect happen concurrently. Game state stays consistent."""

    # Arrange — 5 players with mixed roles, 3 already voted
    # P4 will vote while P5 disconnects
    turn = UndercoverTurn(
        votes={UUID(P1): P3, UUID(P2): P3, UUID(P3): P4},
        phase="voting",
    )

    room = await make_redis_room(ROOM_ID, active_game_id=GAME_ID)
    game = await make_undercover_game(
        game_id=GAME_ID,
        room_id=ROOM_ID,
        players=[
            make_undercover_player(P1, role=UndercoverRole.CIVILIAN),
            make_undercover_player(P2, role=UndercoverRole.CIVILIAN),
            make_undercover_player(P3, role=UndercoverRole.UNDERCOVER),
            make_undercover_player(P4, role=UndercoverRole.CIVILIAN),
            make_undercover_player(P5, role=UndercoverRole.MR_WHITE),
        ],
        turns=[turn],
    )

    vote_p4 = VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P4, voted_user_id=P3)
    sio = AsyncMock()

    # Act — P4 votes while P5 disconnects concurrently
    results = await asyncio.gather(
        set_vote(game, vote_p4),
        handle_undercover_disconnect(sio, P5, room),
        return_exceptions=True,
    )

    # Assert — no exceptions raised
    for r in results:
        assert not isinstance(r, Exception), f"Unexpected exception: {r}"

    # Verify game state is consistent in Redis
    refreshed = await UndercoverGame.get(GAME_ID)

    # P5 should be dead (disconnected)
    p5 = next(p for p in refreshed.players if str(p.user_id) == P5)
    assert p5.is_alive is False

    # P4's vote should be recorded
    assert UUID(P4) in refreshed.turns[-1].votes

    # No duplicate entries in eliminated_players
    eliminated_ids = [str(ep.user_id) for ep in refreshed.eliminated_players]
    assert len(eliminated_ids) == len(set(eliminated_ids)), "No duplicate eliminations"

    # Game state should be valid — at least 2 alive players remain
    alive_count = sum(1 for p in refreshed.players if p.is_alive)
    assert alive_count >= 2
