from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any
from uuid import UUID

from aredis_om import NotFoundError as RedisNotFoundError
from loguru import logger
from pydantic import BaseModel, ValidationError

from ibg.api.models.error import BaseError
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.shared import IBGSocket
from ibg.socketio.models.user import User as RedisUser
from ibg.socketio.utils.redis_ttl import refresh_room_ttl, refresh_user_ttl


def serialize_model(data: Any) -> Any:
    """
    Recursively convert a Pydantic model and any nested UUIDs to a dictionary with stringified UUIDs.
    Handles lists, dicts, and Pydantic models. Converts UUIDs to strings.
    """
    if isinstance(data, BaseModel):
        return {key: serialize_model(value) for key, value in data.model_dump().items()}
    elif isinstance(data, UUID):
        return str(data)
    elif isinstance(data, dict):
        return {key: serialize_model(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [serialize_model(item) for item in data]
    elif isinstance(data, datetime):
        return data.strftime("%Y-%m-%d %H:%M:%S")
    return data


async def send_event_to_client(sio: IBGSocket, event_name: str, data: dict[str, Any], room: str) -> None:
    await sio.emit(event_name, data, room=room)


# Track event counts per SID to reduce TTL refresh frequency
_sid_event_counter: dict[str, int] = {}
_TTL_REFRESH_INTERVAL = 10


def cleanup_sid_counter(sid: str) -> None:
    """Remove a SID from the event counter on disconnect to prevent memory leaks."""
    _sid_event_counter.pop(sid, None)


async def _refresh_ttl_for_sid(sio: IBGSocket, sid: str) -> None:
    """Refresh Redis TTL for the user associated with this socket session.

    Only refreshes every 10th event per SID to reduce Redis round-trips.
    """
    count = _sid_event_counter.get(sid, 0) + 1
    _sid_event_counter[sid] = count
    if count % _TTL_REFRESH_INTERVAL != 1:
        return
    try:
        sio_session = await sio.get_session(sid)
        user_id = sio_session.get("user_id") if sio_session else None
        if not user_id:
            return
        redis_user = await RedisUser.get(user_id)
        await refresh_user_ttl(redis_user)
        if redis_user.room_id:
            redis_room = await RedisRoom.get(redis_user.room_id)
            await refresh_room_ttl(redis_room)
    except (RedisNotFoundError, Exception):
        pass  # Best-effort — don't block the actual event


def socketio_exception_handler(sio):
    def decorator(func):
        @wraps(func)
        async def wrapper(sid, *args, **kwargs):
            logger.info(f"[SIO] {func.__name__} from sid={sid}")
            session = None
            try:
                session = await sio.create_session()
                # Refresh TTL on every socket event so active users never expire
                await _refresh_ttl_for_sid(sio, sid)
                return await func(sid, *args, **kwargs)
            except BaseError as e:
                if session:
                    await session.rollback()
                path = Path(e.__traceback__.tb_frame.f_code.co_filename)
                filename = path.name
                parent_dir = path.parent.name
                grand_parent_folder = path.parent.parent.name
                await sio.emit(
                    "error",
                    {
                        "name": type(e).__name__,
                        "message": str(e),
                        "frontend_message": e.frontend_message,
                        "status_code": e.status_code,
                        "error_key": e.error_key,
                        "exc_info": f"{grand_parent_folder}/{parent_dir}/{filename}:{e.__traceback__.tb_lineno}",
                    },
                    room=sid,
                )
                logger.exception(f"Error: {e}")
            except ValidationError as e:
                if session:
                    await session.rollback()
                errors = e.errors()
                error_messages = str({error["loc"][0]: error["msg"] for error in errors})
                path = Path(e.__traceback__.tb_frame.f_code.co_filename)
                filename = path.name
                parent_dir = path.parent.name
                grand_parent_folder = path.parent.parent.name
                logger.info(
                    {
                        "name": e.__class__.__name__,
                        "message": error_messages,
                        "status_code": 422,
                        "exc_info": f"{grand_parent_folder}/{parent_dir}/{filename}:{e.__traceback__.tb_lineno}",
                    }
                )
                logger.exception(f"Error: {e}")
                await sio.emit(
                    "error",
                    {
                        "name": e.__class__.__name__,
                        "message": error_messages,
                        "status_code": 422,
                    },
                    room=sid,
                )
            except Exception as e:
                if session:
                    await session.rollback()
                date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                path = Path(e.__traceback__.tb_frame.f_code.co_filename)
                filename = path.name
                parent_dir = path.parent.name
                grand_parent_folder = path.parent.parent.name
                logger.critical(
                    {
                        "name": type(e).__name__,
                        "message": repr(e),
                        "datetime": date,
                        "status_code": 500,
                        "exc_info": f"{grand_parent_folder}/{parent_dir}/{filename}:{e.__traceback__.tb_lineno}",
                    }
                )
                logger.exception(f"Error: {e}")
                await sio.emit(
                    "error",
                    {"name": type(e).__name__, "message": repr(e), "status_code": 500},
                    room=sid,
                )
            finally:
                if session:
                    await session.close()

        return wrapper

    return decorator
