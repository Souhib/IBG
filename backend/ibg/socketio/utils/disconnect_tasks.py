import asyncio
from collections.abc import Coroutine

from loguru import logger

# Module-level dict: user_id -> asyncio.Task
_pending_tasks: dict[str, asyncio.Task] = {}


async def _run_after_delay(user_id: str, delay: float, coro: Coroutine) -> None:
    """Sleep for `delay` seconds, then run `coro`. Removes self from pending on completion."""
    try:
        await asyncio.sleep(delay)
        await coro
    except asyncio.CancelledError:
        logger.info(f"[Disconnect] Cleanup cancelled for user_id={user_id} (reconnected)")
    except Exception:
        logger.exception(f"[Disconnect] Error in cleanup for user_id={user_id}")
    finally:
        _pending_tasks.pop(user_id, None)


def schedule_disconnect_cleanup(user_id: str, delay: float, coro: Coroutine) -> None:
    """Schedule a delayed cleanup coroutine for a disconnected user.

    If there's already a pending task for this user, it is cancelled first.

    :param user_id: The user ID.
    :param delay: Seconds to wait before running cleanup.
    :param coro: The cleanup coroutine to run after the delay.
    """
    cancel_disconnect_cleanup(user_id)
    task = asyncio.create_task(_run_after_delay(user_id, delay, coro))
    _pending_tasks[user_id] = task
    logger.info(f"[Disconnect] Scheduled {delay}s cleanup for user_id={user_id}")


def cancel_disconnect_cleanup(user_id: str) -> bool:
    """Cancel a pending disconnect cleanup for a user (on reconnect).

    :param user_id: The user ID.
    :return: True if a pending task was found and cancelled, False otherwise.
    """
    task = _pending_tasks.pop(user_id, None)
    if task and not task.done():
        task.cancel()
        logger.info(f"[Disconnect] Cancelled pending cleanup for user_id={user_id}")
        return True
    return False


def has_pending_disconnect(user_id: str) -> bool:
    """Check if a user has a pending disconnect cleanup.

    :param user_id: The user ID.
    :return: True if there is a pending (not done) cleanup task.
    """
    task = _pending_tasks.get(user_id)
    return task is not None and not task.done()
