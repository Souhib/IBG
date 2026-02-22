"""Tests for socketio_exception_handler decorator."""

from unittest.mock import AsyncMock

from pydantic import BaseModel

from ibg.api.models.error import GameNotFoundError
from ibg.socketio.routes.shared import socketio_exception_handler


def _make_sio():
    """Create a mock SIO with emit and create_session."""
    sio = AsyncMock()
    session = AsyncMock()
    sio.create_session = AsyncMock(return_value=session)
    sio.emit = AsyncMock()
    return sio, session


# ========== socketio_exception_handler ==========


async def test_handler_happy_path():
    """Decorated function runs and returns its result on success."""

    # Arrange
    sio, session = _make_sio()

    @socketio_exception_handler(sio)
    async def my_handler(sid, data):  # noqa: ARG001
        return {"ok": True}

    # Act
    result = await my_handler("sid-1", {"key": "value"})

    # Assert
    assert result == {"ok": True}
    sio.create_session.assert_awaited_once()
    session.close.assert_awaited_once()


async def test_handler_base_error_emits_error_event():
    """BaseError triggers error event emission with correct fields."""

    # Arrange
    sio, session = _make_sio()

    @socketio_exception_handler(sio)
    async def my_handler(sid):  # noqa: ARG001
        raise GameNotFoundError(game_id="game-1")

    # Act
    await my_handler("sid-1")

    # Assert
    sio.emit.assert_awaited_once()
    call_args = sio.emit.call_args
    assert call_args.args[0] == "error"
    error_data = call_args.args[1]
    assert error_data["name"] == "GameNotFoundError"
    assert error_data["status_code"] == 404
    assert "error_key" in error_data
    assert "frontend_message" in error_data
    assert "exc_info" in error_data
    assert call_args.kwargs["room"] == "sid-1"
    session.rollback.assert_awaited_once()
    session.close.assert_awaited_once()


async def test_handler_validation_error_emits_422():
    """ValidationError triggers error event with status 422."""

    # Arrange
    sio, session = _make_sio()

    class StrictModel(BaseModel):
        count: int

    @socketio_exception_handler(sio)
    async def my_handler(sid):  # noqa: ARG001
        StrictModel(count="not_a_number")  # type: ignore[arg-type]

    # Act
    await my_handler("sid-1")

    # Assert
    sio.emit.assert_awaited_once()
    call_args = sio.emit.call_args
    error_data = call_args.args[1]
    assert error_data["name"] == "ValidationError"
    assert error_data["status_code"] == 422
    session.rollback.assert_awaited_once()
    session.close.assert_awaited_once()


async def test_handler_generic_exception_emits_500():
    """Unhandled exceptions trigger error event with status 500."""

    # Arrange
    sio, session = _make_sio()

    @socketio_exception_handler(sio)
    async def my_handler(sid):  # noqa: ARG001
        raise RuntimeError("unexpected failure")

    # Act
    await my_handler("sid-1")

    # Assert
    sio.emit.assert_awaited_once()
    call_args = sio.emit.call_args
    error_data = call_args.args[1]
    assert error_data["name"] == "RuntimeError"
    assert error_data["status_code"] == 500
    assert "unexpected failure" in error_data["message"]
    session.rollback.assert_awaited_once()
    session.close.assert_awaited_once()


async def test_handler_no_session_no_rollback():
    """If create_session fails (returns None), rollback is not called."""

    # Arrange
    sio = AsyncMock()
    sio.create_session = AsyncMock(return_value=None)
    sio.emit = AsyncMock()

    @socketio_exception_handler(sio)
    async def my_handler(sid):  # noqa: ARG001
        raise RuntimeError("oops")

    # Act
    await my_handler("sid-1")

    # Assert
    sio.emit.assert_awaited_once()
    # No rollback because session is None


async def test_handler_preserves_function_name():
    """The decorator preserves the original function name via functools.wraps."""

    # Arrange
    sio, _ = _make_sio()

    @socketio_exception_handler(sio)
    async def my_special_handler(sid):  # noqa: ARG001
        pass

    # Assert
    assert my_special_handler.__name__ == "my_special_handler"


async def test_handler_passes_args_and_kwargs():
    """Arguments and keyword arguments are forwarded to the wrapped function."""

    # Arrange
    sio, _ = _make_sio()
    received = {}

    @socketio_exception_handler(sio)
    async def my_handler(sid, data, extra=None):
        received["sid"] = sid
        received["data"] = data
        received["extra"] = extra

    # Act
    await my_handler("sid-1", {"foo": "bar"}, extra="baz")

    # Assert
    assert received == {"sid": "sid-1", "data": {"foo": "bar"}, "extra": "baz"}
