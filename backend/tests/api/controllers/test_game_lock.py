"""Tests for the game_lock module."""

import asyncio

from ibg.api.controllers.game_lock import _game_locks, cleanup_game_lock, get_game_lock


class TestGetGameLock:
    def setup_method(self):
        """Clear the global lock dict before each test."""
        _game_locks.clear()

    def test_creates_new_lock(self):
        """get_game_lock creates a new asyncio.Lock for an unknown game_id."""
        # Act
        lock = get_game_lock("game-1")

        # Assert
        assert isinstance(lock, asyncio.Lock)
        assert "game-1" in _game_locks

    def test_returns_same_lock_for_same_id(self):
        """get_game_lock returns the same Lock object on repeated calls."""
        # Act
        lock1 = get_game_lock("game-1")
        lock2 = get_game_lock("game-1")

        # Assert
        assert lock1 is lock2

    def test_returns_different_locks_for_different_ids(self):
        """Different game_ids get independent locks."""
        # Act
        lock_a = get_game_lock("game-a")
        lock_b = get_game_lock("game-b")

        # Assert
        assert lock_a is not lock_b


class TestCleanupGameLock:
    def setup_method(self):
        _game_locks.clear()

    def test_removes_existing_lock(self):
        """cleanup_game_lock removes a lock that was previously created."""
        # Prepare
        get_game_lock("game-1")
        assert "game-1" in _game_locks

        # Act
        cleanup_game_lock("game-1")

        # Assert
        assert "game-1" not in _game_locks

    def test_nonexistent_no_error(self):
        """cleanup_game_lock does not raise when the game_id doesn't exist."""
        # Act / Assert — should not raise
        cleanup_game_lock("nonexistent-id")
