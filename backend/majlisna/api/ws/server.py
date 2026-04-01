import socketio

from majlisna.settings import Settings


def _get_redis_url() -> str:
    """Get Redis URL from settings, falling back to default for test environments."""
    try:
        return Settings().redis_url  # type: ignore
    except Exception:
        return "redis://localhost:6379/0"


sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[],  # CORS handled by FastAPI
    client_manager=socketio.AsyncRedisManager(_get_redis_url()),
    ping_interval=15,
    ping_timeout=10,
    logger=False,
    engineio_logger=False,
)

socketio_app = socketio.ASGIApp(sio, socketio_path="/socket.io")

# Register event handlers (side-effect import, must be after sio is created)
import majlisna.api.ws.handlers  # noqa: E402, F401, PLC0415
