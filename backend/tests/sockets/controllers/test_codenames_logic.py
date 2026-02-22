"""Tests for pure logic functions in the Codenames Socket.IO controller."""

from uuid import uuid4

import pytest

from ibg.api.constants import (
    CODENAMES_ASSASSIN_CARDS,
    CODENAMES_BOARD_SIZE,
    CODENAMES_FIRST_TEAM_CARDS,
    CODENAMES_NEUTRAL_CARDS,
    CODENAMES_SECOND_TEAM_CARDS,
)
from ibg.socketio.controllers.codenames import (
    assign_players,
    build_board,
    get_board_for_player,
    get_player_from_game,
)
from ibg.socketio.models.codenames import (
    CodenamesCard,
    CodenamesCardType,
    CodenamesGame,
    CodenamesGameStatus,
    CodenamesPlayer,
    CodenamesRole,
    CodenamesTeam,
)

# --- Helper to create mock room users ---


class MockUser:
    """Minimal mock matching the Redis User interface for assign_players."""

    def __init__(self, user_id: str, username: str, sid: str):
        self.id = user_id
        self.username = username
        self.sid = sid


def _make_users(count: int) -> list[MockUser]:
    return [MockUser(user_id=str(uuid4()), username=f"player{i}", sid=f"sid-{i}") for i in range(count)]


# --- build_board ---


def test_build_board_returns_25_cards():
    """build_board returns exactly CODENAMES_BOARD_SIZE cards."""

    # Arrange
    words = [f"word_{i}" for i in range(CODENAMES_BOARD_SIZE)]

    # Act
    board = build_board(words, CodenamesTeam.RED)

    # Assert
    assert len(board) == CODENAMES_BOARD_SIZE


def test_build_board_card_type_counts_red_first():
    """When RED goes first, RED gets 9 cards, BLUE gets 8, 7 neutral, 1 assassin."""

    # Arrange
    words = [f"word_{i}" for i in range(CODENAMES_BOARD_SIZE)]

    # Act
    board = build_board(words, CodenamesTeam.RED)
    type_counts = {}
    for card in board:
        type_counts[card.card_type] = type_counts.get(card.card_type, 0) + 1

    # Assert
    assert type_counts[CodenamesCardType.RED] == CODENAMES_FIRST_TEAM_CARDS
    assert type_counts[CodenamesCardType.BLUE] == CODENAMES_SECOND_TEAM_CARDS
    assert type_counts[CodenamesCardType.NEUTRAL] == CODENAMES_NEUTRAL_CARDS
    assert type_counts[CodenamesCardType.ASSASSIN] == CODENAMES_ASSASSIN_CARDS


def test_build_board_card_type_counts_blue_first():
    """When BLUE goes first, BLUE gets 9 cards, RED gets 8."""

    # Arrange
    words = [f"word_{i}" for i in range(CODENAMES_BOARD_SIZE)]

    # Act
    board = build_board(words, CodenamesTeam.BLUE)
    type_counts = {}
    for card in board:
        type_counts[card.card_type] = type_counts.get(card.card_type, 0) + 1

    # Assert
    assert type_counts[CodenamesCardType.BLUE] == CODENAMES_FIRST_TEAM_CARDS
    assert type_counts[CodenamesCardType.RED] == CODENAMES_SECOND_TEAM_CARDS


def test_build_board_all_cards_unrevealed():
    """All cards on a new board are unrevealed."""

    # Arrange
    words = [f"word_{i}" for i in range(CODENAMES_BOARD_SIZE)]

    # Act
    board = build_board(words, CodenamesTeam.RED)

    # Assert
    assert all(card.revealed is False for card in board)


def test_build_board_words_preserved():
    """All input words appear on the board in order."""

    # Arrange
    words = [f"word_{i}" for i in range(CODENAMES_BOARD_SIZE)]

    # Act
    board = build_board(words, CodenamesTeam.RED)

    # Assert
    assert [card.word for card in board] == words


# --- assign_players ---


def test_assign_players_4_players():
    """Assigning 4 players gives 2 per team with one spymaster each."""

    # Arrange
    users = _make_users(4)

    # Act
    players = assign_players(users, CodenamesTeam.RED)

    # Assert
    assert len(players) == 4
    red_players = [p for p in players if p.team == CodenamesTeam.RED]
    blue_players = [p for p in players if p.team == CodenamesTeam.BLUE]
    assert len(red_players) == 2
    assert len(blue_players) == 2
    assert sum(1 for p in red_players if p.role == CodenamesRole.SPYMASTER) == 1
    assert sum(1 for p in blue_players if p.role == CodenamesRole.SPYMASTER) == 1


def test_assign_players_5_players_uneven_split():
    """With 5 players, first team gets 3 and second gets 2."""

    # Arrange
    users = _make_users(5)

    # Act
    players = assign_players(users, CodenamesTeam.RED)

    # Assert
    red_players = [p for p in players if p.team == CodenamesTeam.RED]
    blue_players = [p for p in players if p.team == CodenamesTeam.BLUE]
    assert len(red_players) == 3
    assert len(blue_players) == 2


def test_assign_players_each_team_has_one_spymaster():
    """Every team has exactly one spymaster regardless of player count."""

    # Arrange
    users = _make_users(8)

    # Act
    players = assign_players(users, CodenamesTeam.BLUE)

    # Assert
    for team in (CodenamesTeam.RED, CodenamesTeam.BLUE):
        team_players = [p for p in players if p.team == team]
        spymasters = [p for p in team_players if p.role == CodenamesRole.SPYMASTER]
        assert len(spymasters) == 1


def test_assign_players_preserves_user_data():
    """Player objects contain the correct user_id, username, and sid."""

    # Arrange
    users = _make_users(4)

    # Act
    players = assign_players(users, CodenamesTeam.RED)

    # Assert
    player_ids = {str(p.user_id) for p in players}
    user_ids = {u.id for u in users}
    assert player_ids == user_ids


# --- get_player_from_game ---

# Fixed UUIDs for deterministic tests
_SPY_UUID = "11111111-1111-1111-1111-111111111111"
_OP_UUID = "22222222-2222-2222-2222-222222222222"
_PLAYER_UUID = "33333333-3333-3333-3333-333333333333"


def test_get_player_from_game_found():
    """Finding a player by user_id returns the correct player."""

    # Arrange
    player = CodenamesPlayer(
        sid="sid-1", user_id=_PLAYER_UUID, username="player1", team=CodenamesTeam.RED, role=CodenamesRole.OPERATIVE
    )
    game = CodenamesGame(room_id="room-1", id="game-1", players=[player])

    # Act
    found = get_player_from_game(game, _PLAYER_UUID)

    # Assert
    assert str(found.user_id) == _PLAYER_UUID
    assert found.username == "player1"


def test_get_player_from_game_not_found():
    """Looking up a nonexistent user_id raises ValueError."""

    # Arrange
    game = CodenamesGame(room_id="room-1", id="game-1", players=[])

    # Act / Assert
    with pytest.raises(ValueError, match="not found in game"):
        get_player_from_game(game, str(uuid4()))


# --- get_board_for_player ---


def _make_game_with_board() -> CodenamesGame:
    """Create a game with a minimal board for testing board visibility."""
    board = [
        CodenamesCard(word="apple", card_type=CodenamesCardType.RED, revealed=False),
        CodenamesCard(word="banana", card_type=CodenamesCardType.BLUE, revealed=True),
        CodenamesCard(word="cherry", card_type=CodenamesCardType.ASSASSIN, revealed=False),
    ]
    players = [
        CodenamesPlayer(
            sid="s1", user_id=_SPY_UUID, username="spymaster", team=CodenamesTeam.RED, role=CodenamesRole.SPYMASTER
        ),
        CodenamesPlayer(
            sid="s2", user_id=_OP_UUID, username="operative", team=CodenamesTeam.RED, role=CodenamesRole.OPERATIVE
        ),
    ]
    return CodenamesGame(
        room_id="room-1",
        id="game-1",
        board=board,
        players=players,
        status=CodenamesGameStatus.IN_PROGRESS,
    )


def test_get_board_for_spymaster_sees_all_types():
    """Spymaster can see card types for all cards, revealed or not."""

    # Arrange
    game = _make_game_with_board()

    # Act
    board = get_board_for_player(game, _SPY_UUID)

    # Assert
    assert board[0]["card_type"] == "red"  # unrevealed but spymaster sees it
    assert board[1]["card_type"] == "blue"  # revealed
    assert board[2]["card_type"] == "assassin"  # unrevealed but spymaster sees it


def test_get_board_for_operative_hides_unrevealed():
    """Operative cannot see card types for unrevealed cards."""

    # Arrange
    game = _make_game_with_board()

    # Act
    board = get_board_for_player(game, _OP_UUID)

    # Assert
    assert board[0]["card_type"] is None  # unrevealed, hidden from operative
    assert board[1]["card_type"] == "blue"  # revealed, visible
    assert board[2]["card_type"] is None  # unrevealed, hidden


def test_get_board_includes_word_and_index():
    """Board view includes word, index, and revealed status for all players."""

    # Arrange
    game = _make_game_with_board()

    # Act
    board = get_board_for_player(game, _OP_UUID)

    # Assert
    assert board[0]["word"] == "apple"
    assert board[0]["index"] == 0
    assert board[0]["revealed"] is False
    assert board[1]["word"] == "banana"
    assert board[1]["index"] == 1
    assert board[1]["revealed"] is True
