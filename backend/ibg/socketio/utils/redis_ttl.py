from loguru import logger

from ibg.socketio.models.shared import redis_connection

# TTL constants in seconds
GAME_FINISHED_TTL = 3600  # 1 hour after game ends
ROOM_ACTIVITY_TTL = 86400  # 24 hours of inactivity
USER_ACTIVITY_TTL = 86400  # 24 hours (match room TTL — user key must outlive room)


async def set_ttl(model_instance, ttl_seconds: int) -> None:
    """Set a TTL on a Redis OM model instance's key.

    :param model_instance: A RedisJsonModel instance with a pk attribute.
    :param ttl_seconds: Time-to-live in seconds.
    """
    key = model_instance.make_key(model_instance.pk)
    await redis_connection.expire(key, ttl_seconds)
    logger.debug(f"[Redis TTL] Set {ttl_seconds}s TTL on {key}")


async def refresh_room_ttl(redis_room) -> None:
    """Refresh TTL on a room (call on any room activity)."""
    await set_ttl(redis_room, ROOM_ACTIVITY_TTL)


async def refresh_user_ttl(redis_user) -> None:
    """Refresh TTL on a user (call on any socket activity)."""
    await set_ttl(redis_user, USER_ACTIVITY_TTL)


async def set_game_finished_ttl(redis_game) -> None:
    """Set short TTL on a game that has finished."""
    await set_ttl(redis_game, GAME_FINISHED_TTL)
