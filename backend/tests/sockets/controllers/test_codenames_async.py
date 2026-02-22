"""Tests for async Codenames controller functions (give_clue, guess_card, end_turn, get_codenames_game).

Uses real Redis via testcontainers. Only external services (sio, DB controllers) are mocked.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from ibg.api.models.error import (
    GameNotFoundError,
    PlayerRemovedFromGameError,
    RoomAlreadyExistsError,
    RoomNotFoundError,
)
from ibg.api.schemas.error import ForbiddenError, InvalidCredentialsError, UnauthorizedError
from ibg.socketio.controllers.codenames import (
    CardAlreadyRevealedError,
    ClueWordIsOnBoardError,
    GameNotInProgressError,
    InvalidCardIndexError,
    NoClueGivenError,
    NotEnoughPlayersError,
    NotOperativeError,
    NotSpymasterError,
    NotYourTurnError,
    end_turn,
    get_codenames_game,
    give_clue,
    guess_card,
    start_codenames_game,
)
from ibg.socketio.models.codenames import (
    CodenamesGame,
    CodenamesGameStatus,
    CodenamesRole,
    CodenamesTeam,
    CodenamesTurn,
)
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.user import User as RedisUser
from tests.sockets.conftest import make_codenames_board, make_codenames_player

# Fixed UUIDs
SPY_RED = "11111111-1111-1111-1111-111111111111"
OP_RED = "22222222-2222-2222-2222-222222222222"
SPY_BLUE = "33333333-3333-3333-3333-333333333333"
OP_BLUE = "44444444-4444-4444-4444-444444444444"

ROOM_ID = "room-cn-1"
GAME_ID = "game-cn-1"


def _default_players():
    """Standard 4-player setup: red spy, red op, blue spy, blue op."""
    return [
        make_codenames_player(SPY_RED, CodenamesTeam.RED, CodenamesRole.SPYMASTER),
        make_codenames_player(OP_RED, CodenamesTeam.RED, CodenamesRole.OPERATIVE),
        make_codenames_player(SPY_BLUE, CodenamesTeam.BLUE, CodenamesRole.SPYMASTER),
        make_codenames_player(OP_BLUE, CodenamesTeam.BLUE, CodenamesRole.OPERATIVE),
    ]


# ========== get_codenames_game ==========


async def test_get_codenames_game_success(make_codenames_game, make_redis_room):
    """Successfully retrieves a game from Redis."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act
    result = await get_codenames_game(GAME_ID)

    # Assert
    assert result.id == GAME_ID


async def test_get_codenames_game_not_found(redis_cleanup):  # noqa: ARG001
    """Raises GameNotFoundError when game is not in Redis."""

    # Act / Assert
    with pytest.raises(GameNotFoundError):
        await get_codenames_game("nonexistent")


# ========== give_clue ==========


async def test_give_clue_success(make_codenames_game, make_redis_room):
    """Spymaster gives a valid clue on their turn."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act
    result = await give_clue(GAME_ID, SPY_RED, "prophet", 3)

    # Assert
    assert result.current_turn.clue_word == "prophet"
    assert result.current_turn.clue_number == 3
    assert result.current_turn.max_guesses == 4  # clue_number + 1

    # Verify persisted in Redis
    refreshed = await CodenamesGame.get(GAME_ID)
    assert refreshed.current_turn.clue_word == "prophet"


async def test_give_clue_game_not_in_progress(make_codenames_game, make_redis_room):
    """Raises GameNotInProgressError if game is finished."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        status=CodenamesGameStatus.FINISHED,
    )

    # Act / Assert
    with pytest.raises(GameNotInProgressError):
        await give_clue(GAME_ID, SPY_RED, "clue", 2)


async def test_give_clue_not_your_turn(make_codenames_game, make_redis_room):
    """Raises NotYourTurnError if blue spymaster acts on red's turn."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
    )

    # Act / Assert
    with pytest.raises(NotYourTurnError):
        await give_clue(GAME_ID, SPY_BLUE, "clue", 2)


async def test_give_clue_not_spymaster(make_codenames_game, make_redis_room):
    """Raises NotSpymasterError if an operative tries to give a clue."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
    )

    # Act / Assert
    with pytest.raises(NotSpymasterError):
        await give_clue(GAME_ID, OP_RED, "clue", 2)


async def test_give_clue_word_on_board(make_codenames_game, make_redis_room):
    """Raises ClueWordIsOnBoardError if clue word matches a board word."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act / Assert — board has "word_0"
    with pytest.raises(ClueWordIsOnBoardError):
        await give_clue(GAME_ID, SPY_RED, "word_0", 2)


async def test_give_clue_word_on_board_case_insensitive(make_codenames_game, make_redis_room):
    """ClueWordIsOnBoardError check is case-insensitive."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act / Assert
    with pytest.raises(ClueWordIsOnBoardError):
        await give_clue(GAME_ID, SPY_RED, "WORD_0", 2)


# ========== guess_card ==========


async def test_guess_card_correct(make_codenames_game, make_redis_room):
    """Operative guesses own team's card correctly."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=2, guesses_made=0, max_guesses=3
        ),
    )

    # Act — Card at index 0 is RED (own team)
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 0)

    # Assert
    assert result == "correct"
    assert card.revealed is True
    assert result_game.red_remaining == 8  # was 9, now 8


async def test_guess_card_assassin(make_codenames_game, make_redis_room):
    """Guessing the assassin ends the game — other team wins."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — Card at index 24 is ASSASSIN
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 24)

    # Assert
    assert result == "assassin"
    assert result_game.status == CodenamesGameStatus.FINISHED
    assert result_game.winner == CodenamesTeam.BLUE

    # Verify room was cleaned up
    room = await RedisRoom.get(ROOM_ID)
    assert room.active_game_id is None


async def test_guess_card_neutral(make_codenames_game, make_redis_room):
    """Guessing a neutral card ends the turn but not the game."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — Card at index 17 is NEUTRAL (9 red + 8 blue = 17)
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 17)

    # Assert
    assert result == "neutral"
    assert result_game.status == CodenamesGameStatus.IN_PROGRESS
    # Turn switched to blue
    assert result_game.current_team == CodenamesTeam.BLUE


async def test_guess_card_opponent_card(make_codenames_game, make_redis_room):
    """Guessing opponent's card ends the turn and decrements opponent's remaining."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — Card at index 9 is BLUE (opponent)
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 9)

    # Assert
    assert result == "opponent_card"
    assert result_game.blue_remaining == 7  # was 8, now 7
    assert result_game.current_team == CodenamesTeam.BLUE


async def test_guess_card_max_guesses_switches_turn(make_codenames_game, make_redis_room):
    """After using all guesses, turn switches to the other team."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=1, max_guesses=2
        ),
    )

    # Act — Card 0 is RED — correct guess but max guesses reached
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 0)

    # Assert
    assert result == "max_guesses"
    assert result_game.current_team == CodenamesTeam.BLUE


async def test_guess_card_last_red_wins(make_codenames_game, make_redis_room):
    """Red wins when their last card is revealed."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        red_remaining=1,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 0)

    # Assert
    assert result == "win"
    assert result_game.status == CodenamesGameStatus.FINISHED
    assert result_game.winner == CodenamesTeam.RED

    # Verify room was cleaned up
    room = await RedisRoom.get(ROOM_ID)
    assert room.active_game_id is None


async def test_guess_card_last_blue_wins_on_blue_turn(make_codenames_game, make_redis_room):
    """Blue wins when their last card is revealed on their turn."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.BLUE,
        blue_remaining=1,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.BLUE, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — Index 9 is BLUE card
    result_game, card, result = await guess_card(GAME_ID, OP_BLUE, 9)

    # Assert
    assert result == "win"
    assert result_game.status == CodenamesGameStatus.FINISHED
    assert result_game.winner == CodenamesTeam.BLUE


async def test_guess_card_opponent_wins_by_red_guessing_last_blue(make_codenames_game, make_redis_room):
    """Opponent wins when red accidentally reveals the last blue card."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
        blue_remaining=1,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — Index 9 is BLUE card — red team guessing opponent's last card
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 9)

    # Assert
    assert result == "opponent_wins"
    assert result_game.status == CodenamesGameStatus.FINISHED
    assert result_game.winner == CodenamesTeam.BLUE


async def test_guess_card_game_not_in_progress(make_codenames_game, make_redis_room):
    """Raises GameNotInProgressError for finished game."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        status=CodenamesGameStatus.FINISHED,
    )

    # Act / Assert
    with pytest.raises(GameNotInProgressError):
        await guess_card(GAME_ID, OP_RED, 0)


async def test_guess_card_not_your_turn(make_codenames_game, make_redis_room):
    """Raises NotYourTurnError if blue operative acts on red's turn."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
    )

    # Act / Assert
    with pytest.raises(NotYourTurnError):
        await guess_card(GAME_ID, OP_BLUE, 0)


async def test_guess_card_not_operative(make_codenames_game, make_redis_room):
    """Raises NotOperativeError if the spymaster tries to guess."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act / Assert
    with pytest.raises(NotOperativeError):
        await guess_card(GAME_ID, SPY_RED, 0)


async def test_guess_card_no_clue_given(make_codenames_game, make_redis_room):
    """Raises NoClueGivenError if no clue has been given yet."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
        current_turn=CodenamesTurn(team=CodenamesTeam.RED),  # No clue_word
    )

    # Act / Assert
    with pytest.raises(NoClueGivenError):
        await guess_card(GAME_ID, OP_RED, 0)


async def test_guess_card_invalid_index(make_codenames_game, make_redis_room):
    """Raises InvalidCardIndexError for out-of-range index."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act / Assert
    with pytest.raises(InvalidCardIndexError):
        await guess_card(GAME_ID, OP_RED, 25)


async def test_guess_card_negative_index(make_codenames_game, make_redis_room):
    """Raises InvalidCardIndexError for negative index."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act / Assert
    with pytest.raises(InvalidCardIndexError):
        await guess_card(GAME_ID, OP_RED, -1)


async def test_guess_card_already_revealed(make_codenames_game, make_redis_room):
    """Raises CardAlreadyRevealedError for already-revealed card."""

    # Arrange
    board = make_codenames_board()
    board[0].revealed = True

    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=board, players=_default_players(),
        current_team=CodenamesTeam.RED,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act / Assert
    with pytest.raises(CardAlreadyRevealedError):
        await guess_card(GAME_ID, OP_RED, 0)


async def test_guess_card_room_not_found_after_win(make_codenames_game):
    """Room NotFoundError is silently ignored when clearing active game after win."""

    # Arrange — game's room_id doesn't exist in Redis
    await make_codenames_game(
        game_id=GAME_ID, room_id="nonexistent-room",
        board=make_codenames_board(), players=_default_players(),
        red_remaining=1,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — should not raise despite room not found
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 0)

    # Assert
    assert result == "win"


# ========== end_turn ==========


async def test_end_turn_success(make_codenames_game, make_redis_room):
    """Operative voluntarily ends turn, switching to other team."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
    )

    # Act
    result = await end_turn(GAME_ID, OP_RED)

    # Assert
    assert result.current_team == CodenamesTeam.BLUE

    # Verify persisted in Redis
    refreshed = await CodenamesGame.get(GAME_ID)
    assert refreshed.current_team == CodenamesTeam.BLUE


async def test_end_turn_game_not_in_progress(make_codenames_game, make_redis_room):
    """Raises GameNotInProgressError for finished game."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        status=CodenamesGameStatus.FINISHED,
    )

    # Act / Assert
    with pytest.raises(GameNotInProgressError):
        await end_turn(GAME_ID, OP_RED)


async def test_end_turn_not_your_turn(make_codenames_game, make_redis_room):
    """Raises NotYourTurnError if blue operative tries on red's turn."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
    )

    # Act / Assert
    with pytest.raises(NotYourTurnError):
        await end_turn(GAME_ID, OP_BLUE)


async def test_end_turn_not_operative(make_codenames_game, make_redis_room):
    """Raises NotOperativeError if the spymaster tries to end turn."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.RED,
    )

    # Act / Assert
    with pytest.raises(NotOperativeError):
        await end_turn(GAME_ID, SPY_RED)


# ========== Error class instantiation (coverage for error __init__) ==========


def test_not_spymaster_error():
    """NotSpymasterError contains the user_id in details."""

    # Arrange / Act
    err = NotSpymasterError(user_id="user-1")

    # Assert
    assert err.status_code == 403
    assert "user-1" in err.message


def test_not_operative_error():
    """NotOperativeError contains the user_id in details."""

    # Arrange / Act
    err = NotOperativeError(user_id="user-1")

    # Assert
    assert err.status_code == 403


def test_not_your_turn_error():
    """NotYourTurnError contains the user_id in details."""

    # Arrange / Act
    err = NotYourTurnError(user_id="user-1")

    # Assert
    assert err.status_code == 403


def test_card_already_revealed_error():
    """CardAlreadyRevealedError contains the card_index in details."""

    # Arrange / Act
    err = CardAlreadyRevealedError(card_index=5)

    # Assert
    assert err.status_code == 400
    assert err.details["card_index"] == 5


def test_invalid_card_index_error():
    """InvalidCardIndexError contains the card_index in details."""

    # Arrange / Act
    err = InvalidCardIndexError(card_index=30)

    # Assert
    assert err.status_code == 400


def test_no_clue_given_error():
    """NoClueGivenError has correct status code."""

    # Arrange / Act
    err = NoClueGivenError()

    # Assert
    assert err.status_code == 400


def test_game_not_in_progress_error():
    """GameNotInProgressError contains the game_id."""

    # Arrange / Act
    err = GameNotInProgressError(game_id="game-1")

    # Assert
    assert err.status_code == 400


def test_not_enough_players_error():
    """NotEnoughPlayersError contains the player_count."""

    # Arrange / Act
    err = NotEnoughPlayersError(player_count=3)

    # Assert
    assert err.status_code == 400
    assert err.details["player_count"] == 3


def test_clue_word_is_on_board_error():
    """ClueWordIsOnBoardError contains the clue_word."""

    # Arrange / Act
    err = ClueWordIsOnBoardError(clue_word="apple")

    # Assert
    assert err.status_code == 400
    assert "apple" in err.message


# ========== Blue team guess_card branches ==========


async def test_guess_card_blue_correct(make_codenames_game, make_redis_room):
    """Blue operative guesses own team's card correctly."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.BLUE,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.BLUE, clue_word="clue", clue_number=2, guesses_made=0, max_guesses=3
        ),
    )

    # Act — Card at index 9 is BLUE
    result_game, card, result = await guess_card(GAME_ID, OP_BLUE, 9)

    # Assert
    assert result == "correct"
    assert result_game.blue_remaining == 7


async def test_guess_card_blue_max_guesses(make_codenames_game, make_redis_room):
    """Blue team uses all guesses, turn switches to red."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.BLUE,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.BLUE, clue_word="clue", clue_number=1, guesses_made=1, max_guesses=2
        ),
    )

    # Act — Card at index 9 is BLUE — correct but max guesses reached
    result_game, card, result = await guess_card(GAME_ID, OP_BLUE, 9)

    # Assert
    assert result == "max_guesses"
    assert result_game.current_team == CodenamesTeam.RED


async def test_guess_card_blue_guesses_red_card(make_codenames_game, make_redis_room):
    """Blue team guessing red's card ends the turn."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.BLUE,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.BLUE, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — Card at index 0 is RED (opponent for blue)
    result_game, card, result = await guess_card(GAME_ID, OP_BLUE, 0)

    # Assert
    assert result == "opponent_card"
    assert result_game.red_remaining == 8
    assert result_game.current_team == CodenamesTeam.RED


async def test_guess_card_blue_reveals_last_red_opponent_wins(make_codenames_game, make_redis_room):
    """Blue accidentally reveals the last red card, red wins."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.BLUE,
        red_remaining=1,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.BLUE, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — Card at index 0 is RED — opponent's last card
    result_game, card, result = await guess_card(GAME_ID, OP_BLUE, 0)

    # Assert
    assert result == "opponent_wins"
    assert result_game.status == CodenamesGameStatus.FINISHED
    assert result_game.winner == CodenamesTeam.RED


# ========== start_codenames_game ==========


@patch("ibg.socketio.controllers.codenames.random")
async def test_start_codenames_game_success(mock_random, make_redis_room):
    """start_codenames_game creates game in DB and Redis with correct structure."""

    # Arrange
    room_id = uuid4()
    user_id = uuid4()

    # Create real Redis room with real users
    users = [RedisUser(pk=str(uuid4()), id=str(uuid4()), username=f"user_{i}", sid=f"sid-{i}") for i in range(4)]
    await make_redis_room(room_id=str(room_id), users=users, owner_id=str(user_id))

    # Mock SIO and DB
    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.id = room_id
    db_room.owner_id = uuid4()
    mock_sio.room_controller.get_room_by_id = AsyncMock(return_value=db_room)

    # Mock random words from codenames controller
    words = [MagicMock(word=f"word_{i}") for i in range(25)]
    mock_sio.codenames_controller.get_random_words = AsyncMock(return_value=words)

    # Mock random for determinism
    mock_random.choice.return_value = CodenamesTeam.RED
    mock_random.shuffle = MagicMock()

    # Mock DB game creation
    db_game = MagicMock()
    db_game.id = uuid4()
    mock_sio.game_controller.create_game = AsyncMock(return_value=db_game)

    # Act
    result = await start_codenames_game(mock_sio, room_id, user_id)

    # Assert
    assert len(result.players) == 4
    mock_sio.game_controller.create_game.assert_awaited_once()

    # Verify Redis game persisted
    fetched = await CodenamesGame.get(str(db_game.id))
    assert len(fetched.players) == 4

    # Verify room was updated
    fetched_room = await RedisRoom.get(str(room_id))
    assert fetched_room.active_game_id == str(db_game.id)
    assert fetched_room.active_game_type == "codenames"


async def test_start_codenames_game_room_not_found(redis_cleanup):  # noqa: ARG001
    """Raises RoomNotFoundError when Redis room doesn't exist."""

    # Arrange
    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.id = uuid4()  # No matching room in Redis
    mock_sio.room_controller.get_room_by_id = AsyncMock(return_value=db_room)

    # Act / Assert
    with pytest.raises(RoomNotFoundError):
        await start_codenames_game(mock_sio, uuid4(), uuid4())


async def test_start_codenames_game_not_enough_players(make_redis_room):
    """Raises NotEnoughPlayersError with fewer than 4 players."""

    # Arrange
    room_id = str(uuid4())
    users = [RedisUser(pk=str(uuid4()), id=str(uuid4()), username=f"user_{i}", sid=f"sid-{i}") for i in range(3)]
    await make_redis_room(room_id=room_id, users=users)

    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.id = room_id
    mock_sio.room_controller.get_room_by_id = AsyncMock(return_value=db_room)

    # Act / Assert
    with pytest.raises(NotEnoughPlayersError):
        await start_codenames_game(mock_sio, uuid4(), uuid4())


# ========== Uncovered error classes from schemas/error.py ==========


def test_unauthorized_error():
    """UnauthorizedError has 401 status code and correct defaults."""

    # Arrange / Act
    err = UnauthorizedError()

    # Assert
    assert err.status_code == 401
    assert err.error_code == "UnauthorizedError"
    assert "errors.api." in err.error_key


def test_forbidden_error():
    """ForbiddenError has 403 status and correct defaults."""

    # Arrange / Act
    err = ForbiddenError()

    # Assert
    assert err.status_code == 403
    assert err.error_code == "ForbiddenError"
    assert err.frontend_message == "You don't have permission to perform this action."


def test_room_already_exists_error():
    """RoomAlreadyExistsError has 409 status."""

    # Arrange / Act
    err = RoomAlreadyExistsError(room_id=uuid4())

    # Assert
    assert err.status_code == 409


def test_player_removed_from_game_error():
    """PlayerRemovedFromGameError has 403 status."""

    # Arrange / Act
    err = PlayerRemovedFromGameError(user_id="user-1", game_id="game-1")

    # Assert
    assert err.status_code == 403


def test_invalid_credentials_error():
    """InvalidCredentialsError has 401 status and includes email in details."""

    # Arrange / Act
    err = InvalidCredentialsError(email="test@example.com")

    # Assert
    assert err.status_code == 401
    assert err.details["email"] == "test@example.com"
    assert err.error_code == "InvalidCredentialsError"


# ========== Codenames edge cases ==========


async def test_give_clue_zero_number(make_codenames_game, make_redis_room):
    """Clue number 0 is valid — gives operatives 1 guess (0 + 1)."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act
    result = await give_clue(GAME_ID, SPY_RED, "prophet", 0)

    # Assert
    assert result.current_turn.clue_number == 0
    assert result.current_turn.max_guesses == 1  # 0 + 1


async def test_give_clue_large_number(make_codenames_game, make_redis_room):
    """Large clue numbers are accepted — gives many guesses."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act
    result = await give_clue(GAME_ID, SPY_RED, "prophet", 99)

    # Assert
    assert result.current_turn.clue_number == 99
    assert result.current_turn.max_guesses == 100


async def test_give_clue_negative_number(make_codenames_game, make_redis_room):
    """Negative clue number is accepted (no validation exists) — max_guesses = 0."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act
    result = await give_clue(GAME_ID, SPY_RED, "prophet", -1)

    # Assert — -1 + 1 = 0 max_guesses
    assert result.current_turn.clue_number == -1
    assert result.current_turn.max_guesses == 0


async def test_give_clue_overwrites_previous(make_codenames_game, make_redis_room):
    """Giving a clue twice in same turn overwrites the previous clue."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act — give clue twice
    await give_clue(GAME_ID, SPY_RED, "first", 2)
    result = await give_clue(GAME_ID, SPY_RED, "second", 3)

    # Assert — second clue overwrites
    assert result.current_turn.clue_word == "second"
    assert result.current_turn.clue_number == 3


async def test_give_clue_substring_of_board_word_allowed(make_codenames_game, make_redis_room):
    """A clue that is a substring of a board word is allowed (only exact match blocked)."""

    # Arrange — board has "word_0"
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )

    # Act — "word" is a substring of "word_0" but not exact match
    result = await give_clue(GAME_ID, SPY_RED, "word", 2)

    # Assert — no error, clue accepted
    assert result.current_turn.clue_word == "word"


async def test_give_clue_player_not_in_game(make_codenames_game, make_redis_room):
    """Raises ValueError when player is not in the game."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )
    unknown = "99999999-9999-9999-9999-999999999999"

    # Act / Assert
    with pytest.raises(ValueError, match="not found"):
        await give_clue(GAME_ID, unknown, "clue", 2)


async def test_guess_card_blue_assassin(make_codenames_game, make_redis_room):
    """Blue team guessing assassin ends game — red wins."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_team=CodenamesTeam.BLUE,
        current_turn=CodenamesTurn(
            team=CodenamesTeam.BLUE, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — Card at index 24 is ASSASSIN
    result_game, card, result = await guess_card(GAME_ID, OP_BLUE, 24)

    # Assert
    assert result == "assassin"
    assert result_game.status == CodenamesGameStatus.FINISHED
    assert result_game.winner == CodenamesTeam.RED


async def test_guess_card_boundary_index_24(make_codenames_game, make_redis_room):
    """Card index 24 (last valid) is accepted — it's the assassin."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act — index 24 is valid (0-24)
    result_game, card, result = await guess_card(GAME_ID, OP_RED, 24)

    # Assert — it's the assassin
    assert result == "assassin"
    assert card.revealed is True


async def test_guess_card_large_invalid_index(make_codenames_game, make_redis_room):
    """Very large card index raises InvalidCardIndexError."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )

    # Act / Assert
    with pytest.raises(InvalidCardIndexError):
        await guess_card(GAME_ID, OP_RED, 999)


async def test_guess_card_player_not_in_game(make_codenames_game, make_redis_room):
    """Raises ValueError when guessing player is not in the game."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
        current_turn=CodenamesTurn(
            team=CodenamesTeam.RED, clue_word="clue", clue_number=1, guesses_made=0, max_guesses=2
        ),
    )
    unknown = "99999999-9999-9999-9999-999999999999"

    # Act / Assert
    with pytest.raises(ValueError, match="not found"):
        await guess_card(GAME_ID, unknown, 0)


async def test_end_turn_player_not_in_game(make_codenames_game, make_redis_room):
    """Raises ValueError when unknown player tries to end turn."""

    # Arrange
    await make_redis_room(ROOM_ID)
    await make_codenames_game(
        game_id=GAME_ID, room_id=ROOM_ID,
        board=make_codenames_board(), players=_default_players(),
    )
    unknown = "99999999-9999-9999-9999-999999999999"

    # Act / Assert
    with pytest.raises(ValueError, match="not found"):
        await end_turn(GAME_ID, unknown)


async def test_guess_card_game_not_found(redis_cleanup):  # noqa: ARG001
    """Raises GameNotFoundError for nonexistent game."""

    # Act / Assert
    with pytest.raises(GameNotFoundError):
        await guess_card("nonexistent-game", OP_RED, 0)


async def test_end_turn_game_not_found(redis_cleanup):  # noqa: ARG001
    """Raises GameNotFoundError for nonexistent game."""

    # Act / Assert
    with pytest.raises(GameNotFoundError):
        await end_turn("nonexistent-game", OP_RED)


@patch("ibg.socketio.controllers.codenames.random")
async def test_start_codenames_game_not_enough_words(mock_random, make_redis_room):  # noqa: ARG001
    """Raises NotEnoughWordsError when DB doesn't have enough words."""

    from ibg.api.controllers.codenames import NotEnoughWordsError

    # Arrange
    room_id = uuid4()
    user_id = uuid4()
    users = [RedisUser(pk=str(uuid4()), id=str(uuid4()), username=f"user_{i}", sid=f"sid-{i}") for i in range(4)]
    await make_redis_room(room_id=str(room_id), users=users, owner_id=str(user_id))

    mock_sio = MagicMock()
    db_room = MagicMock()
    db_room.id = room_id
    mock_sio.room_controller.get_room_by_id = AsyncMock(return_value=db_room)
    mock_sio.codenames_controller.get_random_words = AsyncMock(
        side_effect=NotEnoughWordsError(requested=25, available=10)
    )

    # Act / Assert
    with pytest.raises(NotEnoughWordsError):
        await start_codenames_game(mock_sio, room_id, user_id)
