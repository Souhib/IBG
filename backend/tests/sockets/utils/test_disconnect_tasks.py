"""Tests for the Redis-based disconnect task scheduler.

Uses real Redis via the `redis_container` fixture from conftest.
"""

import asyncio
import json

import pytest

from ibg.socketio.utils.disconnect_tasks import (
    _MARKER_PREFIX,
    _QUEUE_KEY,
    cancel_disconnect_cleanup,
    has_pending_disconnect,
    schedule_disconnect_cleanup,
    start_polling,
    stop_polling,
)


@pytest.fixture(autouse=True)
async def cleanup_disconnect_state(redis_container):  # noqa: ARG001
    """Clean up disconnect queue and polling state before/after each test."""
    from ibg.socketio.dependencies import get_redis_connection_singleton

    stop_polling()
    conn = get_redis_connection_singleton()
    # Clean up any existing disconnect keys
    await conn.delete(_QUEUE_KEY)
    keys = []
    async for key in conn.scan_iter(f"{_MARKER_PREFIX}*"):
        keys.append(key)
    if keys:
        await conn.delete(*keys)
    yield
    stop_polling()
    await conn.delete(_QUEUE_KEY)
    keys = []
    async for key in conn.scan_iter(f"{_MARKER_PREFIX}*"):
        keys.append(key)
    if keys:
        await conn.delete(*keys)


async def test_schedule_creates_entry():
    """Scheduling cleanup creates a sorted set entry and marker key."""

    # Arrange
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()

    # Act
    await schedule_disconnect_cleanup("user-1", delay=60, room_id="room-1")

    # Assert
    marker = await conn.get(f"{_MARKER_PREFIX}user-1")
    assert marker is not None
    data = json.loads(marker)
    assert data["user_id"] == "user-1"
    assert data["room_id"] == "room-1"

    score = await conn.zscore(_QUEUE_KEY, marker)
    assert score is not None


async def test_cancel_returns_true_when_pending():
    """Cancelling an existing pending entry returns True and cleans up."""

    # Arrange
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()
    await schedule_disconnect_cleanup("user-2", delay=60, room_id="room-2")

    # Act
    result = await cancel_disconnect_cleanup("user-2")

    # Assert
    assert result is True
    assert await conn.exists(f"{_MARKER_PREFIX}user-2") == 0
    assert await conn.zscore(_QUEUE_KEY, json.dumps({"user_id": "user-2", "room_id": "room-2"})) is None


async def test_cancel_returns_false_when_no_entry():
    """Cancelling when no entry exists returns False."""

    # Act
    result = await cancel_disconnect_cleanup("nonexistent")

    # Assert
    assert result is False


async def test_has_pending_disconnect_true():
    """has_pending_disconnect returns True when entry exists."""

    # Arrange
    await schedule_disconnect_cleanup("user-3", delay=60, room_id="room-3")

    # Act / Assert
    assert await has_pending_disconnect("user-3") is True


async def test_has_pending_disconnect_false():
    """has_pending_disconnect returns False for unknown user."""

    # Act / Assert
    assert await has_pending_disconnect("nobody") is False


async def test_schedule_replaces_existing():
    """Scheduling a second cleanup for the same user replaces the first."""

    # Arrange
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()
    await schedule_disconnect_cleanup("user-4", delay=60, room_id="room-a")

    # Act
    await schedule_disconnect_cleanup("user-4", delay=120, room_id="room-b")

    # Assert
    marker = await conn.get(f"{_MARKER_PREFIX}user-4")
    data = json.loads(marker)
    assert data["room_id"] == "room-b"
    # Only one entry in sorted set
    count = await conn.zcard(_QUEUE_KEY)
    assert count == 1


async def test_polling_claims_expired_entries():
    """Polling loop picks up and runs cleanup for expired entries."""

    # Arrange
    cleanup_calls = []

    async def fake_cleanup(user_id, room_id):
        cleanup_calls.append((user_id, room_id))

    # Schedule with delay=0 so it's immediately expired
    await schedule_disconnect_cleanup("user-5", delay=0, room_id="room-5")

    # Act
    start_polling(fake_cleanup)
    # Wait for at least one poll cycle (3s) + buffer
    await asyncio.sleep(5)

    # Assert
    assert ("user-5", "room-5") in cleanup_calls


async def test_polling_does_not_claim_future_entries():
    """Polling loop does NOT claim entries scheduled far in the future."""

    # Arrange
    cleanup_calls = []

    async def fake_cleanup(user_id, room_id):
        cleanup_calls.append((user_id, room_id))

    # Schedule with delay=300 (5 minutes from now)
    await schedule_disconnect_cleanup("user-6", delay=300, room_id="room-6")

    # Act
    start_polling(fake_cleanup)
    await asyncio.sleep(5)

    # Assert — should NOT have been claimed
    assert ("user-6", "room-6") not in cleanup_calls
    # Entry should still be pending
    assert await has_pending_disconnect("user-6") is True


async def test_cancel_after_polling_claimed():
    """Cancelling after polling has already claimed returns False."""

    # Arrange
    cleanup_calls = []

    async def fake_cleanup(user_id, room_id):
        cleanup_calls.append((user_id, room_id))

    await schedule_disconnect_cleanup("user-7", delay=0, room_id="room-7")

    start_polling(fake_cleanup)
    await asyncio.sleep(5)

    # Act — entry already claimed by polling
    result = await cancel_disconnect_cleanup("user-7")

    # Assert
    assert result is False
