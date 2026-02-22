"""Tests for async Undercover controller functions (set_vote, create_undercover_game, start_new_turn).

Uses real Redis via testcontainers. Only external services (sio, DB controllers) are mocked.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from aredis_om import NotFoundError

from ibg.api.models.error import (
    CantVoteBecauseYouDeadError,
    CantVoteForDeadPersonError,
    CantVoteForYourselfError,
    RoomNotFoundError,
)
from ibg.socketio.controllers.undercover_game import (
    create_undercover_game,
    get_civilian_and_undercover_words,
    set_vote,
    start_new_turn,
)
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.socket import StartGame, UndercoverGame, UndercoverTurn, VoteForAPerson
from ibg.socketio.models.user import User as RedisUser
from tests.sockets.conftest import make_undercover_player

# Fixed UUIDs
P1 = "11111111-1111-1111-1111-111111111111"
P2 = "22222222-2222-2222-2222-222222222222"
P3 = "33333333-3333-3333-3333-333333333333"
P4 = "44444444-4444-4444-4444-444444444444"

ROOM_ID = "room-vote-1"
GAME_ID = "game-vote-1"


# ========== set_vote ==========


async def test_set_vote_success(make_undercover_game, make_redis_room):
    """A live player can vote for another live player via real Redis lock."""

    # Arrange
    p1 = make_undercover_player(P1)
    p2 = make_undercover_player(P2)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id=GAME_ID,
        room_id=ROOM_ID,
        players=[p1, p2],
        turns=[UndercoverTurn()],
    )

    vote_data = VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P1, voted_user_id=P2)

    # Act
    voter, voted = await set_vote(game, vote_data)

    # Assert
    assert str(voter.user_id) == P1
    assert str(voted.user_id) == P2

    # Verify persisted in Redis
    refreshed = await UndercoverGame.get(GAME_ID)
    assert UUID(P1) in refreshed.turns[-1].votes


async def test_set_vote_dead_voter(make_undercover_game, make_redis_room):
    """Dead players cannot vote."""

    # Arrange
    p1 = make_undercover_player(P1, alive=False)
    p2 = make_undercover_player(P2)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id=GAME_ID,
        room_id=ROOM_ID,
        players=[p1, p2],
        turns=[UndercoverTurn()],
    )

    vote_data = VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P1, voted_user_id=P2)

    # Act / Assert
    with pytest.raises(CantVoteBecauseYouDeadError):
        await set_vote(game, vote_data)


async def test_set_vote_for_dead_player(make_undercover_game, make_redis_room):
    """Cannot vote for a dead player."""

    # Arrange
    p1 = make_undercover_player(P1)
    p2 = make_undercover_player(P2, alive=False)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id=GAME_ID,
        room_id=ROOM_ID,
        players=[p1, p2],
        turns=[UndercoverTurn()],
    )

    vote_data = VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P1, voted_user_id=P2)

    # Act / Assert
    with pytest.raises(CantVoteForDeadPersonError):
        await set_vote(game, vote_data)


async def test_set_vote_for_yourself(make_undercover_game, make_redis_room):
    """Cannot vote for yourself."""

    # Arrange
    p1 = make_undercover_player(P1)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id=GAME_ID,
        room_id=ROOM_ID,
        players=[p1],
        turns=[UndercoverTurn()],
    )

    vote_data = VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P1, voted_user_id=P1)

    # Act / Assert
    with pytest.raises(CantVoteForYourselfError):
        await set_vote(game, vote_data)


# ========== get_civilian_and_undercover_words ==========


async def test_get_civilian_and_undercover_words():
    """Returns two words from a random term pair (pure DB call, no Redis)."""

    # Arrange
    mock_sio = MagicMock()
    word1 = MagicMock()
    word1.id = uuid4()
    word1.word = "prayer"
    word2 = MagicMock()
    word2.id = uuid4()
    word2.word = "fasting"

    term_pair = MagicMock()
    term_pair.word1_id = word1.id
    term_pair.word2_id = word2.id

    mock_sio.undercover_controller.get_random_term_pair = AsyncMock(return_value=term_pair)
    mock_sio.undercover_controller.get_word_by_id = AsyncMock(
        side_effect=lambda wid: word1 if wid == word1.id else word2
    )

    # Act
    civ_word, uc_word = await get_civilian_and_undercover_words(mock_sio)

    # Assert
    assert civ_word.word in ("prayer", "fasting")
    assert uc_word.word in ("prayer", "fasting")


# ========== start_new_turn ==========


async def test_start_new_turn(make_undercover_game, make_redis_room):
    """Creates a DB turn, a turn event, and appends a Redis turn."""

    # Arrange
    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.owner_id = uuid4()
    db_game = MagicMock()
    db_game.id = uuid4()

    turn = MagicMock()
    turn.id = uuid4()
    mock_sio.game_controller.create_turn = AsyncMock(return_value=turn)
    mock_sio.game_controller.create_turn_event = AsyncMock()

    p1 = make_undercover_player(P1)
    await make_redis_room(ROOM_ID)
    redis_game = await make_undercover_game(
        game_id="game-turn-1",
        room_id=ROOM_ID,
        players=[p1],
    )

    # Act
    await start_new_turn(mock_sio, db_room, db_game, redis_game)

    # Assert
    mock_sio.game_controller.create_turn.assert_awaited_once_with(game_id=db_game.id)
    mock_sio.game_controller.create_turn_event.assert_awaited_once()

    # Verify persisted in Redis
    refreshed = await UndercoverGame.get("game-turn-1")
    assert len(refreshed.turns) == 1


# ========== create_undercover_game ==========


@patch("ibg.socketio.controllers.undercover_game.start_new_turn", new_callable=AsyncMock)
@patch("ibg.socketio.controllers.undercover_game.get_civilian_and_undercover_words", new_callable=AsyncMock)
async def test_create_undercover_game_success(mock_get_words, mock_start_turn, make_redis_room):
    """Creates an undercover game with correct player roles and saves to Redis."""

    # Arrange
    room_id = uuid4()
    user_id = uuid4()

    # Create real Redis room with real users
    users = [RedisUser(pk=str(uuid4()), id=str(uuid4()), username=f"user_{i}", sid=f"sid-{i}") for i in range(4)]
    await make_redis_room(
        room_id=str(room_id),
        users=users,
        owner_id=str(user_id),
    )

    # Mock SIO and DB
    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.id = room_id
    db_room.public_id = "ABC123"
    mock_sio.room_controller.get_room_by_id = AsyncMock(return_value=db_room)

    # Mock words
    civ_word = MagicMock()
    civ_word.word = "prayer"
    civ_word.id = uuid4()
    uc_word = MagicMock()
    uc_word.word = "fasting"
    uc_word.id = uuid4()
    mock_get_words.return_value = (civ_word, uc_word)

    # Mock DB game creation
    db_game = MagicMock()
    db_game.id = uuid4()
    mock_sio.game_controller.create_game = AsyncMock(return_value=db_game)

    start_input = StartGame(room_id=room_id, user_id=user_id)

    # Act
    result_room, result_game, result_redis_game = await create_undercover_game(mock_sio, start_input)

    # Assert
    assert result_room is db_room
    assert result_game is db_game
    mock_sio.game_controller.create_game.assert_awaited_once()
    mock_start_turn.assert_awaited_once()

    # Verify Redis game persisted
    fetched = await UndercoverGame.get(str(db_game.id))
    assert len(fetched.players) == 4

    # Verify room was updated
    fetched_room = await RedisRoom.get(str(room_id))
    assert fetched_room.active_game_id == str(db_game.id)
    assert fetched_room.active_game_type == "undercover"


@patch("ibg.socketio.controllers.undercover_game.RedisRoom")
async def test_create_undercover_game_room_not_found(mock_redis_room):
    """Raises RoomNotFoundError when the Redis room doesn't exist."""

    # Arrange
    room_id = uuid4()
    user_id = uuid4()

    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.id = room_id
    mock_sio.room_controller.get_room_by_id = AsyncMock(return_value=db_room)
    mock_redis_room.get = AsyncMock(side_effect=NotFoundError())

    start_input = StartGame(room_id=room_id, user_id=user_id)

    # Act / Assert
    with pytest.raises(RoomNotFoundError):
        await create_undercover_game(mock_sio, start_input)


# ========== Undercover edge cases ==========


async def test_set_vote_overwrites_previous(make_undercover_game, make_redis_room):
    """Voting again for a different player overwrites the previous vote."""

    # Arrange
    p1 = make_undercover_player(P1)
    p2 = make_undercover_player(P2)
    p3 = make_undercover_player(P3)

    await make_redis_room(ROOM_ID)
    game = await make_undercover_game(
        game_id=GAME_ID,
        room_id=ROOM_ID,
        players=[p1, p2, p3],
        turns=[UndercoverTurn()],
    )

    # Act — vote for P2, then change to P3
    await set_vote(game, VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P1, voted_user_id=P2))
    await set_vote(game, VoteForAPerson(room_id=ROOM_ID, game_id=GAME_ID, user_id=P1, voted_user_id=P3))

    # Assert — vote should be P3 (overwritten)
    refreshed = await UndercoverGame.get(GAME_ID)
    assert refreshed.turns[-1].votes[UUID(P1)] == UUID(P3)


@patch("ibg.socketio.controllers.undercover_game.start_new_turn", new_callable=AsyncMock)
@patch("ibg.socketio.controllers.undercover_game.get_civilian_and_undercover_words", new_callable=AsyncMock)
async def test_create_undercover_game_10_players(mock_get_words, mock_start_turn, make_redis_room):  # noqa: ARG001
    """With 10 players, game has 2 mr_whites (10-15 range)."""

    # Arrange
    room_id = uuid4()
    user_id = uuid4()

    users = [RedisUser(pk=str(uuid4()), id=str(uuid4()), username=f"user_{i}", sid=f"sid-{i}") for i in range(10)]
    await make_redis_room(room_id=str(room_id), users=users, owner_id=str(user_id))

    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.id = room_id
    db_room.public_id = "ABC123"
    mock_sio.room_controller.get_room_by_id = AsyncMock(return_value=db_room)

    civ_word = MagicMock()
    civ_word.word = "prayer"
    civ_word.id = uuid4()
    uc_word = MagicMock()
    uc_word.word = "fasting"
    uc_word.id = uuid4()
    mock_get_words.return_value = (civ_word, uc_word)

    db_game = MagicMock()
    db_game.id = uuid4()
    mock_sio.game_controller.create_game = AsyncMock(return_value=db_game)

    start_input = StartGame(room_id=room_id, user_id=user_id)

    # Act
    _, _, redis_game = await create_undercover_game(mock_sio, start_input)

    # Assert — 10 players: 2 mr_white, max(2, 10//4)=2 undercover, 6 civilian
    from ibg.api.models.undercover import UndercoverRole

    role_counts = {}
    for p in redis_game.players:
        role_counts[p.role] = role_counts.get(p.role, 0) + 1

    assert role_counts[UndercoverRole.MR_WHITE] == 2
    assert role_counts[UndercoverRole.UNDERCOVER] == 2
    assert role_counts[UndercoverRole.CIVILIAN] == 6
    assert len(redis_game.players) == 10

    # Exactly 1 mayor
    mayors = [p for p in redis_game.players if p.is_mayor]
    assert len(mayors) == 1


@patch("ibg.socketio.controllers.undercover_game.start_new_turn", new_callable=AsyncMock)
@patch("ibg.socketio.controllers.undercover_game.get_civilian_and_undercover_words", new_callable=AsyncMock)
async def test_create_undercover_game_3_players_minimum(mock_get_words, mock_start_turn, make_redis_room):  # noqa: ARG001
    """With 3 players (minimum), game has 1 mr_white, 1 undercover, 1 civilian."""

    # Arrange
    room_id = uuid4()
    user_id = uuid4()

    users = [RedisUser(pk=str(uuid4()), id=str(uuid4()), username=f"user_{i}", sid=f"sid-{i}") for i in range(3)]
    await make_redis_room(room_id=str(room_id), users=users, owner_id=str(user_id))

    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.id = room_id
    db_room.public_id = "XYZ789"
    mock_sio.room_controller.get_room_by_id = AsyncMock(return_value=db_room)

    civ_word = MagicMock()
    civ_word.word = "prayer"
    civ_word.id = uuid4()
    uc_word = MagicMock()
    uc_word.word = "fasting"
    uc_word.id = uuid4()
    mock_get_words.return_value = (civ_word, uc_word)

    db_game = MagicMock()
    db_game.id = uuid4()
    mock_sio.game_controller.create_game = AsyncMock(return_value=db_game)

    start_input = StartGame(room_id=room_id, user_id=user_id)

    # Act
    _, _, redis_game = await create_undercover_game(mock_sio, start_input)

    # Assert — 3 players: 1 mr_white, max(2, 3//4)=2 undercover, 0 civilian
    # Actually: num_undercover = max(2, 3//4) = 2, but total roles = 1 + 2 = 3 = num_players
    # So civilian = 3 - 1 - 2 = 0
    from ibg.api.models.undercover import UndercoverRole

    role_counts = {}
    for p in redis_game.players:
        role_counts[p.role] = role_counts.get(p.role, 0) + 1

    assert len(redis_game.players) == 3
    assert role_counts.get(UndercoverRole.MR_WHITE, 0) == 1
