"""Tests for shared Socket.IO utilities (serialize_model, send_event_to_client)."""

from datetime import datetime
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

from pydantic import BaseModel

from ibg.socketio.routes.shared import send_event_to_client, serialize_model

# --- serialize_model ---


def test_serialize_uuid():
    """Serializing a UUID returns its string representation."""

    # Arrange
    uid = uuid4()

    # Act
    result = serialize_model(uid)

    # Assert
    assert result == str(uid)
    assert isinstance(result, str)


def test_serialize_datetime():
    """Serializing a datetime returns a formatted string."""

    # Arrange
    dt = datetime(2025, 6, 15, 14, 30, 0)

    # Act
    result = serialize_model(dt)

    # Assert
    assert result == "2025-06-15 14:30:00"


def test_serialize_dict_with_uuid_values():
    """Serializing a dict recursively converts UUID values to strings."""

    # Arrange
    uid = uuid4()
    data = {"id": uid, "name": "test"}

    # Act
    result = serialize_model(data)

    # Assert
    assert result == {"id": str(uid), "name": "test"}


def test_serialize_list_of_uuids():
    """Serializing a list of UUIDs returns a list of strings."""

    # Arrange
    uids = [uuid4(), uuid4()]

    # Act
    result = serialize_model(uids)

    # Assert
    assert all(isinstance(r, str) for r in result)
    assert len(result) == 2


def test_serialize_pydantic_model():
    """Serializing a Pydantic model returns a dict with stringified UUIDs."""

    # Arrange
    class SampleModel(BaseModel):
        id: UUID
        name: str

    model = SampleModel(id=uuid4(), name="test")

    # Act
    result = serialize_model(model)

    # Assert
    assert isinstance(result, dict)
    assert isinstance(result["id"], str)
    assert result["name"] == "test"


def test_serialize_nested_structure():
    """Serializing a nested dict/list/UUID structure works recursively."""

    # Arrange
    uid = uuid4()
    data = {"users": [{"id": uid, "active": True}]}

    # Act
    result = serialize_model(data)

    # Assert
    assert result["users"][0]["id"] == str(uid)
    assert result["users"][0]["active"] is True


def test_serialize_none():
    """Serializing None returns None."""

    # Arrange / Act / Assert
    assert serialize_model(None) is None


def test_serialize_primitives():
    """Serializing primitive types returns them unchanged."""

    # Arrange / Act / Assert
    assert serialize_model(42) == 42
    assert serialize_model("hello") == "hello"
    assert serialize_model(True) is True


# --- send_event_to_client ---


async def test_send_event_to_client_calls_emit():
    """send_event_to_client calls sio.emit with the correct arguments."""

    # Arrange
    mock_sio = AsyncMock()
    data = {"message": "hello"}

    # Act
    await send_event_to_client(mock_sio, "test_event", data, room="room-123")

    # Assert
    mock_sio.emit.assert_awaited_once_with("test_event", data, room="room-123")
