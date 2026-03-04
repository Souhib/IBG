"""Redis-based disconnect task scheduler for multi-worker coordination.

Uses a Redis sorted set (`ibg:disconnect_queue`) with fire-at timestamps as
scores, plus marker keys (`ibg:disconnect:{user_id}`) for O(1) existence
checks. A background polling loop in each worker atomically claims expired
entries via ZREM (only one worker wins), preventing double-cleanup.
"""

import asyncio
import json
import time
from collections.abc import Awaitable, Callable

from loguru import logger

from ibg.socketio.dependencies import get_redis_connection_singleton

_QUEUE_KEY = "ibg:disconnect_queue"
_MARKER_PREFIX = "ibg:disconnect:"
_POLL_INTERVAL = 3  # seconds

_polling_task: asyncio.Task | None = None
_cleanup_factory: Callable[[str, str], Awaitable[None]] | None = None


async def schedule_disconnect_cleanup(user_id: str, delay: float, room_id: str) -> None:
    """Schedule a delayed cleanup for a disconnected user via Redis.

    If there's already a pending entry for this user, it is replaced.

    :param user_id: The user ID.
    :param delay: Seconds to wait before running cleanup.
    :param room_id: The room ID the user was in.
    """
    redis = get_redis_connection_singleton()
    fire_at = time.time() + delay
    payload = json.dumps({"user_id": user_id, "room_id": room_id})

    # Remove any existing entry for this user first
    existing = await redis.get(f"{_MARKER_PREFIX}{user_id}")
    if existing:
        await redis.zrem(_QUEUE_KEY, existing)

    await redis.zadd(_QUEUE_KEY, {payload: fire_at})
    await redis.set(f"{_MARKER_PREFIX}{user_id}", payload, ex=int(delay) + 300)
    logger.info(f"[Disconnect] Scheduled {delay}s cleanup for user_id={user_id}, room_id={room_id}")


async def cancel_disconnect_cleanup(user_id: str) -> bool:
    """Cancel a pending disconnect cleanup for a user (on reconnect).

    :param user_id: The user ID.
    :return: True if a pending entry was found and removed, False otherwise.
    """
    redis = get_redis_connection_singleton()
    marker_key = f"{_MARKER_PREFIX}{user_id}"
    payload = await redis.get(marker_key)
    if not payload:
        return False

    removed = await redis.zrem(_QUEUE_KEY, payload)
    await redis.delete(marker_key)
    if removed:
        logger.info(f"[Disconnect] Cancelled pending cleanup for user_id={user_id}")
        return True
    return False


async def has_pending_disconnect(user_id: str) -> bool:
    """Check if a user has a pending disconnect cleanup.

    :param user_id: The user ID.
    :return: True if there is a pending cleanup entry.
    """
    redis = get_redis_connection_singleton()
    return await redis.exists(f"{_MARKER_PREFIX}{user_id}") > 0


def start_polling(cleanup_factory: Callable[[str, str], Awaitable[None]]) -> None:
    """Start the background polling loop (idempotent, called once per worker).

    :param cleanup_factory: Async callable(user_id, room_id) that runs permanent cleanup.
    """
    global _polling_task, _cleanup_factory  # noqa: PLW0603
    if _polling_task is not None and not _polling_task.done():
        return
    _cleanup_factory = cleanup_factory
    _polling_task = asyncio.create_task(_poll_loop())
    logger.info("[Disconnect] Started polling loop for disconnect queue")


def stop_polling() -> None:
    """Stop the background polling loop (called on shutdown)."""
    global _polling_task  # noqa: PLW0603
    if _polling_task is not None and not _polling_task.done():
        _polling_task.cancel()
        logger.info("[Disconnect] Stopped polling loop")
    _polling_task = None


async def _poll_loop() -> None:
    """Poll Redis sorted set for expired disconnect entries."""
    redis = get_redis_connection_singleton()
    while True:
        try:
            now = time.time()
            # Get all entries whose fire-at time has passed
            expired = await redis.zrangebyscore(_QUEUE_KEY, "-inf", now)
            for payload in expired:
                # Atomically remove — only one worker gets result > 0
                removed = await redis.zrem(_QUEUE_KEY, payload)
                if removed:
                    try:
                        data = json.loads(payload)
                        user_id = data["user_id"]
                        room_id = data["room_id"]
                        # Clean up marker key
                        await redis.delete(f"{_MARKER_PREFIX}{user_id}")
                        logger.info(f"[Disconnect] Polling: claimed cleanup for user_id={user_id}")
                        if _cleanup_factory:
                            await _cleanup_factory(user_id, room_id)
                    except Exception:
                        logger.exception("[Disconnect] Error running cleanup from poll")
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("[Disconnect] Error in poll loop")
        await asyncio.sleep(_POLL_INTERVAL)
