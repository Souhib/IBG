"""Route-level tests for undercover game action endpoints (/api/v1/undercover/games)."""

from unittest.mock import AsyncMock, Mock
from uuid import uuid4

from fastapi import FastAPI
from starlette.testclient import TestClient

from majlisna.api.controllers.undercover_game import UndercoverGameController
from majlisna.api.models.error import GameNotFoundError
from majlisna.api.models.table import User
from majlisna.api.schemas.common import GameStartResponse, HintRecordResponse
from majlisna.api.schemas.undercover import (
    DescriptionOrderEntry,
    StartNextRoundResponse,
    SubmitDescriptionResponse,
    SubmitVoteResponse,
    UndercoverGameState,
)
from majlisna.dependencies import get_current_user, get_undercover_game_controller

BASE_URL = "/api/v1/undercover"


def _mock_user() -> User:
    return User(
        id=uuid4(),
        username="testplayer",
        email_address="player@test.com",
        country="FRA",
        password="securepassword",
    )


# ========== POST /undercover/games/{room_id}/start ==========


def test_start_game_success(test_app: FastAPI, client: TestClient) -> None:
    """Starting an undercover game returns 201 with game_id and room_id."""
    # Arrange
    room_id = uuid4()
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.create_and_start = AsyncMock(
        return_value=GameStartResponse(game_id=str(game_id), room_id=str(room_id))
    )
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(f"{BASE_URL}/games/{room_id}/start")

        # Assert
        assert response.status_code == 201
        data = response.json()
        assert data["game_id"] == str(game_id)
        assert data["room_id"] == str(room_id)
        mock_controller.create_and_start.assert_awaited_once_with(room_id, user.id)
    finally:
        test_app.dependency_overrides.clear()


def test_start_game_unauthenticated(test_app: FastAPI, client: TestClient) -> None:
    """Starting a game without auth returns 401."""
    # Arrange
    room_id = uuid4()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(f"{BASE_URL}/games/{room_id}/start")

        # Assert
        assert response.status_code == 401
    finally:
        test_app.dependency_overrides.clear()


# ========== GET /undercover/games/{game_id}/state ==========


def test_state_get_success(test_app: FastAPI, client: TestClient) -> None:
    """Getting game state returns 200 with full state."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    state_response = UndercoverGameState(
        game_id=str(game_id),
        room_id=str(uuid4()),
        is_host=True,
        my_role="civilian",
        my_word="prayer",
        my_word_hint=None,
        is_alive=True,
        players=[],
        eliminated_players=[],
        turn_number=1,
        winner=None,
        vote_history=[],
        votes={},
        has_voted=False,
        turn_phase="describing",
        description_order=[],
        current_describer_index=0,
        descriptions={},
    )
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.get_state = AsyncMock(return_value=state_response)
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.get(f"{BASE_URL}/games/{game_id}/state")

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["game_id"] == str(game_id)
        assert data["my_role"] == "civilian"
        assert data["is_alive"] is True
        assert data["turn_phase"] == "describing"
        mock_controller.get_state.assert_awaited_once_with(game_id, user.id, lang="en", sid=None)
    finally:
        test_app.dependency_overrides.clear()


def test_state_with_sid(test_app: FastAPI, client: TestClient) -> None:
    """Getting state with sid query param passes it to the controller."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.get_state = AsyncMock(
        return_value=UndercoverGameState(
            game_id=str(game_id),
            room_id=str(uuid4()),
            is_host=False,
            my_role="civilian",
            my_word="test",
            my_word_hint=None,
            is_alive=True,
            players=[],
            eliminated_players=[],
            turn_number=1,
            winner=None,
            vote_history=[],
            votes={},
            has_voted=False,
            turn_phase="describing",
            description_order=[],
            current_describer_index=0,
            descriptions={},
        )
    )
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.get(f"{BASE_URL}/games/{game_id}/state?sid=new-sid-456")

        # Assert
        assert response.status_code == 200
        mock_controller.get_state.assert_awaited_once_with(game_id, user.id, lang="en", sid="new-sid-456")
    finally:
        test_app.dependency_overrides.clear()


def test_state_game_not_found(test_app: FastAPI, client: TestClient) -> None:
    """Getting state for a nonexistent game returns 404."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.get_state = AsyncMock(side_effect=GameNotFoundError(game_id=game_id))
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.get(f"{BASE_URL}/games/{game_id}/state")

        # Assert
        assert response.status_code == 404
        data = response.json()
        assert data["error"] == "GameNotFoundError"
    finally:
        test_app.dependency_overrides.clear()


def test_state_unauthenticated(test_app: FastAPI, client: TestClient) -> None:
    """Getting state without auth returns 401."""
    # Arrange
    game_id = uuid4()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.get(f"{BASE_URL}/games/{game_id}/state")

        # Assert
        assert response.status_code == 401
    finally:
        test_app.dependency_overrides.clear()


# ========== POST /undercover/games/{game_id}/describe ==========


def test_describe_success(test_app: FastAPI, client: TestClient) -> None:
    """Submitting a description returns 200 with result."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.submit_description = AsyncMock(
        return_value=SubmitDescriptionResponse(game_id=str(game_id), all_described=False, word="building")
    )
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/describe",
            json={"word": "building"},
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["word"] == "building"
        assert data["all_described"] is False
        mock_controller.submit_description.assert_awaited_once_with(game_id, user.id, "building")
    finally:
        test_app.dependency_overrides.clear()


def test_describe_missing_word(test_app: FastAPI, client: TestClient) -> None:
    """Submitting without word returns 422."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(f"{BASE_URL}/games/{game_id}/describe", json={})

        # Assert
        assert response.status_code == 422
    finally:
        test_app.dependency_overrides.clear()


def test_describe_unauthenticated(test_app: FastAPI, client: TestClient) -> None:
    """Submitting a description without auth returns 401."""
    # Arrange
    game_id = uuid4()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/describe",
            json={"word": "building"},
        )

        # Assert
        assert response.status_code == 401
    finally:
        test_app.dependency_overrides.clear()


# ========== POST /undercover/games/{game_id}/vote ==========


def test_vote_success(test_app: FastAPI, client: TestClient) -> None:
    """Submitting a vote returns 200 with result."""
    # Arrange
    game_id = uuid4()
    voted_for = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.submit_vote = AsyncMock(return_value=SubmitVoteResponse(game_id=str(game_id), all_voted=False))
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/vote",
            json={"voted_for": str(voted_for)},
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["all_voted"] is False
        mock_controller.submit_vote.assert_awaited_once_with(game_id, user.id, voted_for)
    finally:
        test_app.dependency_overrides.clear()


def test_vote_all_voted(test_app: FastAPI, client: TestClient) -> None:
    """When all players have voted, response includes elimination info."""
    # Arrange
    game_id = uuid4()
    voted_for = uuid4()
    eliminated_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.submit_vote = AsyncMock(
        return_value=SubmitVoteResponse(
            game_id=str(game_id),
            all_voted=True,
            eliminated_player=str(eliminated_id),
            winner=None,
        )
    )
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/vote",
            json={"voted_for": str(voted_for)},
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["all_voted"] is True
        assert data["eliminated_player"] == str(eliminated_id)
        assert data["winner"] is None
    finally:
        test_app.dependency_overrides.clear()


def test_vote_missing_voted_for(test_app: FastAPI, client: TestClient) -> None:
    """Submitting without voted_for returns 422."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(f"{BASE_URL}/games/{game_id}/vote", json={})

        # Assert
        assert response.status_code == 422
    finally:
        test_app.dependency_overrides.clear()


def test_vote_invalid_uuid(test_app: FastAPI, client: TestClient) -> None:
    """Submitting with invalid UUID returns 422."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/vote",
            json={"voted_for": "not-a-uuid"},
        )

        # Assert
        assert response.status_code == 422
    finally:
        test_app.dependency_overrides.clear()


def test_vote_unauthenticated(test_app: FastAPI, client: TestClient) -> None:
    """Voting without auth returns 401."""
    # Arrange
    game_id = uuid4()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/vote",
            json={"voted_for": str(uuid4())},
        )

        # Assert
        assert response.status_code == 401
    finally:
        test_app.dependency_overrides.clear()


# ========== POST /undercover/games/{game_id}/next-round ==========


def test_next_round_success(test_app: FastAPI, client: TestClient) -> None:
    """Starting next round returns 200 with turn info."""
    # Arrange
    game_id = uuid4()
    room_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.start_next_round = AsyncMock(
        return_value=StartNextRoundResponse(
            game_id=str(game_id),
            turn_number=2,
            description_order=[
                DescriptionOrderEntry(user_id=str(uuid4()), username="player1"),
            ],
        )
    )
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/next-round",
            json={"room_id": str(room_id)},
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["turn_number"] == 2
        assert len(data["description_order"]) == 1
        mock_controller.start_next_round.assert_awaited_once_with(game_id, room_id, user.id)
    finally:
        test_app.dependency_overrides.clear()


def test_next_round_missing_room_id(test_app: FastAPI, client: TestClient) -> None:
    """Starting next round without room_id returns 422."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(f"{BASE_URL}/games/{game_id}/next-round", json={})

        # Assert
        assert response.status_code == 422
    finally:
        test_app.dependency_overrides.clear()


def test_next_round_unauthenticated(test_app: FastAPI, client: TestClient) -> None:
    """Starting next round without auth returns 401."""
    # Arrange
    game_id = uuid4()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/next-round",
            json={"room_id": str(uuid4())},
        )

        # Assert
        assert response.status_code == 401
    finally:
        test_app.dependency_overrides.clear()


# ========== POST /undercover/games/{game_id}/hint-viewed ==========


def test_hint_viewed_success(test_app: FastAPI, client: TestClient) -> None:
    """Recording a hint view returns 200 with recorded=True."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.record_hint_view = AsyncMock(return_value=HintRecordResponse(game_id=str(game_id), recorded=True))
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/hint-viewed",
            json={"word": "mosque"},
        )

        # Assert
        assert response.status_code == 200
        data = response.json()
        assert data["recorded"] is True
        mock_controller.record_hint_view.assert_awaited_once_with(game_id, user.id, "mosque")
    finally:
        test_app.dependency_overrides.clear()


def test_hint_viewed_missing_word(test_app: FastAPI, client: TestClient) -> None:
    """Recording a hint view without the word field returns 422."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(f"{BASE_URL}/games/{game_id}/hint-viewed", json={})

        # Assert
        assert response.status_code == 422
    finally:
        test_app.dependency_overrides.clear()


def test_hint_viewed_unauthenticated(test_app: FastAPI, client: TestClient) -> None:
    """Recording a hint view without auth returns 401."""
    # Arrange
    game_id = uuid4()
    mock_controller = Mock(spec=UndercoverGameController)
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.post(
            f"{BASE_URL}/games/{game_id}/hint-viewed",
            json={"word": "mosque"},
        )

        # Assert
        assert response.status_code == 401
    finally:
        test_app.dependency_overrides.clear()


# ========== GET /undercover/games/{game_id}/state — lang parameter ==========


def test_state_with_lang_param(test_app: FastAPI, client: TestClient) -> None:
    """Getting state with lang query param passes it to the controller."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.get_state = AsyncMock(
        return_value=UndercoverGameState(
            game_id=str(game_id),
            room_id=str(uuid4()),
            is_host=False,
            my_role="civilian",
            my_word="test",
            my_word_hint=None,
            is_alive=True,
            players=[],
            eliminated_players=[],
            turn_number=1,
            winner=None,
            vote_history=[],
            votes={},
            has_voted=False,
            turn_phase="describing",
            description_order=[],
            current_describer_index=0,
            descriptions={},
        )
    )
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.get(f"{BASE_URL}/games/{game_id}/state?lang=fr")

        # Assert
        assert response.status_code == 200
        mock_controller.get_state.assert_awaited_once_with(game_id, user.id, lang="fr", sid=None)
    finally:
        test_app.dependency_overrides.clear()


def test_state_with_lang_and_sid(test_app: FastAPI, client: TestClient) -> None:
    """Getting state with both lang and sid query params passes both to the controller."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.get_state = AsyncMock(
        return_value=UndercoverGameState(
            game_id=str(game_id),
            room_id=str(uuid4()),
            is_host=False,
            my_role="civilian",
            my_word="test",
            my_word_hint=None,
            is_alive=True,
            players=[],
            eliminated_players=[],
            turn_number=1,
            winner=None,
            vote_history=[],
            votes={},
            has_voted=False,
            turn_phase="describing",
            description_order=[],
            current_describer_index=0,
            descriptions={},
        )
    )
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.get(f"{BASE_URL}/games/{game_id}/state?lang=ar&sid=my-sid")

        # Assert
        assert response.status_code == 200
        mock_controller.get_state.assert_awaited_once_with(game_id, user.id, lang="ar", sid="my-sid")
    finally:
        test_app.dependency_overrides.clear()


def test_state_defaults_lang_to_en(test_app: FastAPI, client: TestClient) -> None:
    """Getting state without lang defaults to 'en'."""
    # Arrange
    game_id = uuid4()
    user = _mock_user()
    mock_controller = Mock(spec=UndercoverGameController)
    mock_controller.get_state = AsyncMock(
        return_value=UndercoverGameState(
            game_id=str(game_id),
            room_id=str(uuid4()),
            is_host=False,
            my_role="civilian",
            my_word="test",
            my_word_hint=None,
            is_alive=True,
            players=[],
            eliminated_players=[],
            turn_number=1,
            winner=None,
            vote_history=[],
            votes={},
            has_voted=False,
            turn_phase="describing",
            description_order=[],
            current_describer_index=0,
            descriptions={},
        )
    )
    test_app.dependency_overrides[get_current_user] = lambda: user
    test_app.dependency_overrides[get_undercover_game_controller] = lambda: mock_controller

    try:
        # Act
        response = client.get(f"{BASE_URL}/games/{game_id}/state")

        # Assert
        assert response.status_code == 200
        mock_controller.get_state.assert_awaited_once_with(game_id, user.id, lang="en", sid=None)
    finally:
        test_app.dependency_overrides.clear()
