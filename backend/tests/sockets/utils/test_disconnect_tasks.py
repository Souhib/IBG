"""Tests for the disconnect task scheduler (pure async, no Redis dependency)."""

import asyncio

import pytest

from ibg.socketio.utils.disconnect_tasks import (
    _pending_tasks,
    cancel_disconnect_cleanup,
    has_pending_disconnect,
    schedule_disconnect_cleanup,
)


@pytest.fixture(autouse=True)
def clear_pending_tasks():
    """Clear the global pending tasks dict before and after each test."""
    _pending_tasks.clear()
    yield
    # Cancel any leftover tasks to avoid warnings
    for task in _pending_tasks.values():
        if not task.done():
            task.cancel()
    _pending_tasks.clear()


async def test_schedule_disconnect_cleanup_adds_task():
    """Scheduling cleanup adds a pending task for the user."""

    # Arrange
    user_id = "user-1"

    async def noop():
        pass

    # Act
    schedule_disconnect_cleanup(user_id, delay=10, coro=noop())

    # Assert
    assert has_pending_disconnect(user_id) is True


async def test_cancel_disconnect_cleanup_returns_true():
    """Cancelling an existing pending task returns True."""

    # Arrange
    user_id = "user-2"

    async def noop():
        await asyncio.sleep(100)

    schedule_disconnect_cleanup(user_id, delay=100, coro=noop())

    # Act
    result = cancel_disconnect_cleanup(user_id)

    # Assert
    assert result is True
    assert has_pending_disconnect(user_id) is False


async def test_cancel_disconnect_cleanup_no_task_returns_false():
    """Cancelling when no task exists returns False."""

    # Arrange
    user_id = "nonexistent"

    # Act
    result = cancel_disconnect_cleanup(user_id)

    # Assert
    assert result is False


async def test_has_pending_disconnect_false_for_unknown_user():
    """Checking pending disconnect for an unknown user returns False."""

    # Arrange / Act / Assert
    assert has_pending_disconnect("nobody") is False


async def test_schedule_replaces_existing_task():
    """Scheduling a second cleanup for the same user cancels the first."""

    # Arrange
    user_id = "user-3"
    first_ran = False

    async def first_coro():
        nonlocal first_ran
        first_ran = True

    async def second_coro():
        pass

    schedule_disconnect_cleanup(user_id, delay=100, coro=first_coro())

    # Act
    schedule_disconnect_cleanup(user_id, delay=100, coro=second_coro())
    await asyncio.sleep(0.05)  # Let cancellation propagate

    # Assert
    assert first_ran is False
    assert has_pending_disconnect(user_id) is True


async def test_task_runs_after_delay():
    """The cleanup coroutine actually runs after the specified delay."""

    # Arrange
    ran = False

    async def my_coro():
        nonlocal ran
        ran = True

    # Act
    schedule_disconnect_cleanup("user-4", delay=0.05, coro=my_coro())
    await asyncio.sleep(0.15)

    # Assert
    assert ran is True
    assert has_pending_disconnect("user-4") is False


async def test_task_removed_from_pending_after_completion():
    """After the task completes, the user is removed from _pending_tasks."""

    # Arrange
    async def quick():
        pass

    schedule_disconnect_cleanup("user-5", delay=0.01, coro=quick())

    # Act
    await asyncio.sleep(0.1)

    # Assert
    assert "user-5" not in _pending_tasks


async def test_task_handles_coroutine_exception():
    """If the cleanup coroutine raises, the task is still removed from pending."""

    # Arrange
    async def failing():
        raise RuntimeError("boom")

    # Act
    schedule_disconnect_cleanup("user-6", delay=0.01, coro=failing())
    await asyncio.sleep(0.1)

    # Assert
    assert has_pending_disconnect("user-6") is False
    assert "user-6" not in _pending_tasks


async def test_cancel_after_completion_returns_false():
    """Cancelling after the task has already completed returns False."""

    # Arrange
    async def quick():
        pass

    schedule_disconnect_cleanup("user-7", delay=0.01, coro=quick())
    await asyncio.sleep(0.1)

    # Act
    result = cancel_disconnect_cleanup("user-7")

    # Assert
    assert result is False
