"""Tests for Undercover controller logic (eliminate_player_based_on_votes, check_if_a_team_has_win).

Uses real Redis via testcontainers — no mocked game objects.
"""

from uuid import UUID

from ibg.api.models.undercover import UndercoverRole
from ibg.socketio.controllers.undercover_game import (
    check_if_a_team_has_win,
    eliminate_player_based_on_votes,
)
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.socket import UndercoverGame, UndercoverTurn
from tests.sockets.conftest import make_undercover_player

# Fixed UUIDs
P1 = "11111111-1111-1111-1111-111111111111"
P2 = "22222222-2222-2222-2222-222222222222"
P3 = "33333333-3333-3333-3333-333333333333"
P4 = "44444444-4444-4444-4444-444444444444"
P5 = "55555555-5555-5555-5555-555555555555"

ROOM_ID = "room-logic-1"


# ========== eliminate_player_based_on_votes ==========


async def test_eliminate_clear_majority(make_undercover_game, make_redis_room):
    """The player with the most votes is eliminated."""

    # Arrange
    p1 = make_undercover_player(P1)
    p2 = make_undercover_player(P2)
    p3 = make_undercover_player(P3)
    votes = {UUID(P1): P3, UUID(P2): P3}
    turn = UndercoverTurn(votes=votes)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-elim-1",
        room_id=ROOM_ID,
        players=[p1, p2, p3],
        turns=[turn],
    )

    # Act
    eliminated, vote_count = await eliminate_player_based_on_votes(game)

    # Assert
    assert str(eliminated.user_id) == P3
    assert vote_count == 2
    assert eliminated in game.eliminated_players

    # Verify persisted in Redis
    refreshed = await UndercoverGame.get("game-elim-1")
    assert len(refreshed.eliminated_players) == 1


async def test_eliminate_tie_mayor_breaks(make_undercover_game, make_redis_room):
    """When votes are tied, the mayor's vote breaks the tie."""

    # Arrange
    p1 = make_undercover_player(P1, is_mayor=True)
    p2 = make_undercover_player(P2)
    p3 = make_undercover_player(P3)
    votes = {UUID(P1): P2, UUID(P2): P3}
    turn = UndercoverTurn(votes=votes)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-elim-2",
        room_id=ROOM_ID,
        players=[p1, p2, p3],
        turns=[turn],
    )

    # Act
    eliminated, vote_count = await eliminate_player_based_on_votes(game)

    # Assert — mayor voted for p2, so p2 should be eliminated in tie
    assert str(eliminated.user_id) == P2
    assert vote_count == 1


async def test_eliminate_tie_no_mayor_vote_match(make_undercover_game, make_redis_room):
    """When tied and mayor didn't vote for any tied player, first tied player is eliminated."""

    # Arrange
    p1 = make_undercover_player(P1, is_mayor=True)
    p2 = make_undercover_player(P2)
    p3 = make_undercover_player(P3)
    p4 = make_undercover_player(P4)
    p5 = make_undercover_player(P5)
    votes = {UUID(P1): P4, UUID(P2): P3, UUID(P3): P2, UUID(P4): P3, UUID(P5): P2}
    turn = UndercoverTurn(votes=votes)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-elim-3",
        room_id=ROOM_ID,
        players=[p1, p2, p3, p4, p5],
        turns=[turn],
    )

    # Act
    eliminated, _count = await eliminate_player_based_on_votes(game)

    # Assert — p2 and p3 each have 2 votes, mayor voted for p4 (not in tie)
    assert str(eliminated.user_id) in (P2, P3)


# ========== check_if_a_team_has_win ==========


async def test_civilians_win_all_undercover_and_mr_white_dead(make_undercover_game, make_redis_room):
    """Civilians win when all undercovers and mr_whites are dead."""

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P2, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P3, role=UndercoverRole.UNDERCOVER, alive=False),
        make_undercover_player(P4, role=UndercoverRole.MR_WHITE, alive=False),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-1",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert
    assert winner == UndercoverRole.CIVILIAN

    # Verify room was cleaned up (active_game_id cleared)
    room = await RedisRoom.get(ROOM_ID)
    assert room.active_game_id is None


async def test_undercovers_win_no_civilians_alive(make_undercover_game, make_redis_room):
    """Undercovers win when no civilians are alive."""

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=False),
        make_undercover_player(P2, role=UndercoverRole.UNDERCOVER, alive=True),
        make_undercover_player(P3, role=UndercoverRole.MR_WHITE, alive=True),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-2",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert
    assert winner == UndercoverRole.UNDERCOVER


async def test_undercovers_win_no_mr_white_alive(make_undercover_game, make_redis_room):
    """Undercovers win when no mr_whites are alive (even if civilians exist)."""

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P2, role=UndercoverRole.UNDERCOVER, alive=True),
        make_undercover_player(P3, role=UndercoverRole.MR_WHITE, alive=False),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-3",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert
    assert winner == UndercoverRole.UNDERCOVER


async def test_no_winner_yet(make_undercover_game, make_redis_room):
    """No winner when all roles still have alive players."""

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P2, role=UndercoverRole.UNDERCOVER, alive=True),
        make_undercover_player(P3, role=UndercoverRole.MR_WHITE, alive=True),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-4",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert
    assert winner is None


async def test_no_winner_3_player_no_mr_white(make_undercover_game, make_redis_room):
    """No winner in a 3-player game with no Mr. White (2 civilians + 1 undercover)."""

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P2, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P3, role=UndercoverRole.UNDERCOVER, alive=True),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-no-mw-1",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert — no Mr. White in game, all roles alive → no winner
    assert winner is None


async def test_civilians_win_3_player_no_mr_white(make_undercover_game, make_redis_room):
    """Civilians win in a 3-player game when the undercover is eliminated (no Mr. White)."""

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P2, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P3, role=UndercoverRole.UNDERCOVER, alive=False),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-no-mw-2",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert
    assert winner == UndercoverRole.CIVILIAN


async def test_undercovers_win_3_player_no_mr_white(make_undercover_game, make_redis_room):
    """Undercovers win in a 3-player game when all civilians are eliminated (no Mr. White)."""

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=False),
        make_undercover_player(P2, role=UndercoverRole.CIVILIAN, alive=False),
        make_undercover_player(P3, role=UndercoverRole.UNDERCOVER, alive=True),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-no-mw-3",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert
    assert winner == UndercoverRole.UNDERCOVER


# ========== Undercover logic edge cases ==========


async def test_eliminate_unanimous_vote(make_undercover_game, make_redis_room):
    """All players vote for the same person — they are eliminated with max votes."""

    # Arrange
    p1 = make_undercover_player(P1)
    p2 = make_undercover_player(P2)
    p3 = make_undercover_player(P3)
    votes = {UUID(P1): P3, UUID(P2): P3, UUID(P3): P1}
    turn = UndercoverTurn(votes=votes)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-elim-unan",
        room_id=ROOM_ID,
        players=[p1, p2, p3],
        turns=[turn],
    )

    # Act
    eliminated, vote_count = await eliminate_player_based_on_votes(game)

    # Assert — P3 has 2 votes (majority)
    assert str(eliminated.user_id) == P3
    assert vote_count == 2


async def test_eliminate_three_way_tie(make_undercover_game, make_redis_room):
    """Three-way tie — first tied player is eliminated when mayor not involved."""

    # Arrange — 6 players, each pair votes for a different player
    p6_id = "66666666-6666-6666-6666-666666666666"

    p1 = make_undercover_player(P1, is_mayor=True)
    p2 = make_undercover_player(P2)
    p3 = make_undercover_player(P3)
    p4 = make_undercover_player(P4)
    p5 = make_undercover_player(P5)
    p6 = make_undercover_player(p6_id)

    # Each of P2, P4, P5 gets 2 votes each → 3-way tie
    # Mayor (P1) voted for p6_id → not in tie
    votes = {UUID(P1): p6_id, UUID(P2): P4, UUID(P3): P2, UUID(P4): P5, UUID(P5): P2, UUID(p6_id): P4}
    turn = UndercoverTurn(votes=votes)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-elim-3way",
        room_id=ROOM_ID,
        players=[p1, p2, p3, p4, p5, p6],
        turns=[turn],
    )

    # Act
    eliminated, vote_count = await eliminate_player_based_on_votes(game)

    # Assert — should be first tied player (P2, P4, or P5 depending on dict ordering)
    assert vote_count == 2
    assert str(eliminated.user_id) in (P2, P4, P5)


async def test_check_win_room_not_found(make_undercover_game, redis_cleanup):  # noqa: ARG001
    """check_if_a_team_has_win handles room NotFoundError gracefully (lines 204-205)."""

    # Arrange — game references a non-existent room
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P2, role=UndercoverRole.UNDERCOVER, alive=False),
        make_undercover_player(P3, role=UndercoverRole.MR_WHITE, alive=False),
    ]
    game = await make_undercover_game(
        game_id="game-win-noroom",
        room_id="nonexistent-room",
        players=players,
    )

    # Act — civilians win, but room doesn't exist — should not raise
    winner = await check_if_a_team_has_win(game)

    # Assert
    assert winner == UndercoverRole.CIVILIAN


async def test_check_win_only_undercover_alive(make_undercover_game, make_redis_room):
    """Undercovers win when only undercover players are alive (all mr_white dead)."""

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=False),
        make_undercover_player(P2, role=UndercoverRole.CIVILIAN, alive=False),
        make_undercover_player(P3, role=UndercoverRole.UNDERCOVER, alive=True),
        make_undercover_player(P4, role=UndercoverRole.UNDERCOVER, alive=True),
        make_undercover_player(P5, role=UndercoverRole.MR_WHITE, alive=False),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-uc-only",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert — both conditions met: no civilians AND no mr_whites
    # The civilian == 0 condition triggers first → undercover wins
    assert winner == UndercoverRole.UNDERCOVER


# ========== Additional edge cases ==========


async def test_eliminate_four_way_tie(make_undercover_game, make_redis_room):
    """Four-way tie — mayor voted for non-tied player, first tied player is eliminated."""

    # Arrange — 9 players, 4 candidates each with 2 votes, mayor voted for P9
    P6 = "66666666-6666-6666-6666-666666666666"  # noqa: N806
    P7 = "77777777-7777-7777-7777-777777777777"  # noqa: N806
    P8 = "88888888-8888-8888-8888-888888888888"  # noqa: N806
    P9 = "99999999-9999-9999-9999-999999999999"  # noqa: N806

    p1 = make_undercover_player(P1, is_mayor=True)
    p2 = make_undercover_player(P2)
    p3 = make_undercover_player(P3)
    p4 = make_undercover_player(P4)
    p5 = make_undercover_player(P5)
    p6 = make_undercover_player(P6)
    p7 = make_undercover_player(P7)
    p8 = make_undercover_player(P8)
    p9 = make_undercover_player(P9)

    # P3:2 (P2,P6), P4:2 (P3,P7), P5:2 (P4,P8), P6:2 (P5,P9), P9:1 (P1)
    votes = {
        UUID(P1): P9,  # Mayor votes for P9 (not in tie)
        UUID(P2): P3,
        UUID(P3): P4,
        UUID(P4): P5,
        UUID(P5): P6,
        UUID(P6): P3,
        UUID(P7): P4,
        UUID(P8): P5,
        UUID(P9): P6,
    }
    turn = UndercoverTurn(votes=votes)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-elim-4way",
        room_id=ROOM_ID,
        players=[p1, p2, p3, p4, p5, p6, p7, p8, p9],
        turns=[turn],
    )

    # Act
    eliminated, vote_count = await eliminate_player_based_on_votes(game)

    # Assert — 4-way tie (P3, P4, P5, P6), mayor voted for P9 (not in tie)
    # First tied player should be eliminated
    assert vote_count == 2
    assert str(eliminated.user_id) in (P3, P4, P5, P6)
    assert len(game.eliminated_players) == 1


async def test_winning_team_undercover_outnumber_civilians(make_undercover_game, make_redis_room):
    """Undercovers outnumber civilians but Mr. White is dead — undercovers win via mr_white condition."""

    # Arrange — 2 undercover alive, 1 civilian alive, 1 mr_white dead
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P2, role=UndercoverRole.UNDERCOVER, alive=True),
        make_undercover_player(P3, role=UndercoverRole.UNDERCOVER, alive=True),
        make_undercover_player(P4, role=UndercoverRole.MR_WHITE, alive=False),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-uc-outnumber",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert — total_mr_white > 0 and num_alive_mr_white == 0 → undercovers win
    assert winner == UndercoverRole.UNDERCOVER


async def test_winning_team_only_mr_white_alive(make_undercover_game, make_redis_room):
    """All civilians and undercovers dead, only Mr. White alive — undercovers win.

    Mr. White is on the undercover team. num_alive_civilian == 0 triggers the
    undercover win condition, even though undercover-role players are also dead.
    """

    # Arrange
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=False),
        make_undercover_player(P2, role=UndercoverRole.CIVILIAN, alive=False),
        make_undercover_player(P3, role=UndercoverRole.UNDERCOVER, alive=False),
        make_undercover_player(P4, role=UndercoverRole.MR_WHITE, alive=True),
    ]
    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-mw-only",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert — num_alive_civilian == 0 → undercovers win
    assert winner == UndercoverRole.UNDERCOVER


async def test_winning_team_mixed_alive_no_winner(make_undercover_game, make_redis_room):
    """All three roles have alive players (with some dead) — no winner yet."""

    # Arrange — 6 players, 1 of each role alive + 1 of each role dead
    players = [
        make_undercover_player(P1, role=UndercoverRole.CIVILIAN, alive=True),
        make_undercover_player(P2, role=UndercoverRole.CIVILIAN, alive=False),
        make_undercover_player(P3, role=UndercoverRole.UNDERCOVER, alive=True),
        make_undercover_player(P4, role=UndercoverRole.UNDERCOVER, alive=False),
        make_undercover_player(P5, role=UndercoverRole.MR_WHITE, alive=True),
    ]
    P6 = "66666666-6666-6666-6666-666666666666"  # noqa: N806
    players.append(make_undercover_player(P6, role=UndercoverRole.MR_WHITE, alive=False))

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id="game-win-mixed",
        room_id=ROOM_ID,
        players=players,
    )

    # Act
    winner = await check_if_a_team_has_win(game)

    # Assert — all three conditions return None
    assert winner is None
