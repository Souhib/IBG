"""Tests for the Redis TTL utility functions.

Uses real Redis via testcontainers to verify TTL is actually set on keys.
"""

from ibg.socketio.utils.redis_ttl import (
    GAME_FINISHED_TTL,
    ROOM_ACTIVITY_TTL,
    USER_ACTIVITY_TTL,
    refresh_room_ttl,
    refresh_user_ttl,
    set_game_finished_ttl,
    set_ttl,
)
from tests.sockets.conftest import make_undercover_player


async def test_set_ttl_calls_expire(make_redis_room):
    """set_ttl sets a TTL on the model's Redis key."""

    # Arrange
    room = await make_redis_room("ttl-room-1")

    # Act
    await set_ttl(room, 3600)

    # Assert
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()
    key = room.make_key(room.pk)
    ttl = await conn.ttl(key)
    assert 0 < ttl <= 3600


async def test_refresh_room_ttl_uses_room_constant(make_redis_room):
    """refresh_room_ttl sets ROOM_ACTIVITY_TTL (24 hours) on the room key."""

    # Arrange
    room = await make_redis_room("ttl-room-2")

    # Act
    await refresh_room_ttl(room)

    # Assert
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()
    key = room.make_key(room.pk)
    ttl = await conn.ttl(key)
    assert 0 < ttl <= ROOM_ACTIVITY_TTL


async def test_refresh_user_ttl_uses_user_constant(make_redis_user):
    """refresh_user_ttl sets USER_ACTIVITY_TTL (1 hour) on the user key."""

    # Arrange
    user = await make_redis_user(user_id="ttl-user-1", username="test_user", sid="sid-1")

    # Act
    await refresh_user_ttl(user)

    # Assert
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()
    key = user.make_key(user.pk)
    ttl = await conn.ttl(key)
    assert 0 < ttl <= USER_ACTIVITY_TTL


async def test_set_game_finished_ttl_uses_game_constant(make_undercover_game, make_redis_room):
    """set_game_finished_ttl sets GAME_FINISHED_TTL (1 hour) on the game key."""

    # Arrange
    await make_redis_room("ttl-room-3")
    game = await make_undercover_game(
        game_id="ttl-game-1", room_id="ttl-room-3",
        players=[make_undercover_player("11111111-1111-1111-1111-111111111111")],
    )

    # Act
    await set_game_finished_ttl(game)

    # Assert
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()
    key = game.make_key(game.pk)
    ttl = await conn.ttl(key)
    assert 0 < ttl <= GAME_FINISHED_TTL


def test_ttl_constants():
    """TTL constants have expected values."""

    # Assert
    assert ROOM_ACTIVITY_TTL == 86400  # 24 hours
    assert USER_ACTIVITY_TTL == 86400  # 24 hours (match room TTL)
    assert GAME_FINISHED_TTL == 3600  # 1 hour
