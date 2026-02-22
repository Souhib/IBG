"""Tests for Socket.IO model validation (Pydantic input models).

Pure Python tests — no Redis needed.
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from ibg.socketio.models.codenames import (
    EndTurn,
    GetBoard,
    GiveClue,
    GuessCard,
    StartCodenamesGame,
)
from ibg.socketio.models.room import JoinRoomUser, LeaveRoomUser
from ibg.socketio.models.socket import StartGame, VoteForAPerson

# ========== JoinRoomUser ==========


def test_join_room_user_valid():
    """Valid JoinRoomUser with 4-digit password."""
    user = JoinRoomUser(user_id=uuid4(), public_room_id="ABCD", password="1234")
    assert user.password == "1234"


def test_join_room_user_password_not_digits():
    """Password must only contain digits."""
    with pytest.raises(ValidationError, match="Password must only contain digits"):
        JoinRoomUser(user_id=uuid4(), public_room_id="ABCD", password="abcd")


def test_join_room_user_password_too_short():
    """Password must be exactly 4 characters."""
    with pytest.raises(ValidationError):
        JoinRoomUser(user_id=uuid4(), public_room_id="ABCD", password="123")


def test_join_room_user_password_too_long():
    """Password must be exactly 4 characters."""
    with pytest.raises(ValidationError):
        JoinRoomUser(user_id=uuid4(), public_room_id="ABCD", password="12345")


def test_join_room_user_mixed_password():
    """Password with mixed alpha-numeric characters fails."""
    with pytest.raises(ValidationError, match="Password must only contain digits"):
        JoinRoomUser(user_id=uuid4(), public_room_id="ABCD", password="12ab")


# ========== LeaveRoomUser ==========


def test_leave_room_user_valid():
    """Valid LeaveRoomUser."""
    user = LeaveRoomUser(user_id=uuid4(), room_id=uuid4(), username="test")
    assert user.username == "test"


# ========== StartGame (Undercover) ==========


def test_start_game_valid():
    """Valid StartGame with UUIDs."""
    game = StartGame(room_id=uuid4(), user_id=uuid4())
    assert game.room_id is not None


def test_start_game_invalid_uuid():
    """StartGame rejects non-UUID strings."""
    with pytest.raises(ValidationError):
        StartGame(room_id="not-a-uuid", user_id="also-not-a-uuid")


# ========== VoteForAPerson ==========


def test_vote_for_a_person_valid():
    """Valid VoteForAPerson."""
    vote = VoteForAPerson(room_id="room-1", game_id="game-1", user_id="user-1", voted_user_id="user-2")
    assert vote.user_id == "user-1"


# ========== StartCodenamesGame ==========


def test_start_codenames_game_valid():
    """Valid StartCodenamesGame with optional word_pack_ids."""
    game = StartCodenamesGame(room_id=uuid4(), user_id=uuid4())
    assert game.word_pack_ids is None


def test_start_codenames_game_with_word_packs():
    """StartCodenamesGame accepts a list of word pack IDs."""
    pack_ids = [uuid4(), uuid4()]
    game = StartCodenamesGame(room_id=uuid4(), user_id=uuid4(), word_pack_ids=pack_ids)
    assert len(game.word_pack_ids) == 2


# ========== GiveClue ==========


def test_give_clue_valid():
    """Valid GiveClue."""
    clue = GiveClue(room_id="room-1", game_id="game-1", user_id="user-1", clue_word="prophet", clue_number=3)
    assert clue.clue_word == "prophet"


# ========== GuessCard ==========


def test_guess_card_valid():
    """Valid GuessCard."""
    guess = GuessCard(room_id="room-1", game_id="game-1", user_id="user-1", card_index=12)
    assert guess.card_index == 12


# ========== EndTurn ==========


def test_end_turn_valid():
    """Valid EndTurn."""
    turn = EndTurn(room_id="room-1", game_id="game-1", user_id="user-1")
    assert turn.game_id == "game-1"


# ========== GetBoard ==========


def test_get_board_valid():
    """Valid GetBoard with optional room_id."""
    board = GetBoard(game_id="game-1", user_id="user-1")
    assert board.room_id is None


def test_get_board_with_room_id():
    """GetBoard accepts optional room_id."""
    board = GetBoard(game_id="game-1", user_id="user-1", room_id="room-1")
    assert board.room_id == "room-1"
