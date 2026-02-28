import contextvars

import socketio
from aredis_om import JsonModel
from loguru import logger
from sqlmodel.ext.asyncio.session import AsyncSession

from ibg.api.controllers.codenames import CodenamesController
from ibg.api.controllers.game import GameController
from ibg.api.controllers.room import RoomController
from ibg.api.controllers.undercover import UndercoverController
from ibg.api.controllers.user import UserController
from ibg.database import get_engine
from ibg.socketio.dependencies import get_redis_connection_singleton

redis_connection = get_redis_connection_singleton()

# Per-event session stored in a ContextVar so concurrent socket events
# each get their own session without overwriting each other.
_event_session: contextvars.ContextVar[AsyncSession | None] = contextvars.ContextVar(
    "_event_session", default=None
)


class IBGSocket(socketio.AsyncServer):
    """Socket.IO server with per-event database session management.

    Sessions are stored in a ContextVar so concurrent socket events each
    get their own isolated session. Controllers are created fresh per-access
    since the session changes per event.
    """

    def __init__(
        self,
        cors_origins: list[str] | None = None,
        ping_interval: int = 25,
        ping_timeout: int = 60,
    ):
        from ibg.socketio.controllers.room import SocketRoomController

        allowed_origins = cors_origins or ["*"]
        super().__init__(
            async_mode="asgi",
            cors_allowed_origins=allowed_origins,
            ping_interval=ping_interval,
            ping_timeout=ping_timeout,
        )
        self._socket_room_controller_cls = SocketRoomController
        logger.info(f"[SIO] IBGSocket initialized with CORS origins: {allowed_origins}")

    async def create_session(self) -> AsyncSession:
        """Create a fresh async session for the current event.

        Stores the session in a ContextVar so each concurrent event
        gets its own isolated session.
        """
        engine = await get_engine()
        session = AsyncSession(engine, expire_on_commit=False)
        _event_session.set(session)
        return session

    @property
    def _current_session(self) -> AsyncSession:
        session = _event_session.get()
        if session is None:
            raise RuntimeError("No session for current socket event")
        return session

    @property
    def room_controller(self) -> RoomController:
        return RoomController(self._current_session)

    @property
    def game_controller(self) -> GameController:
        return GameController(self._current_session)

    @property
    def user_controller(self) -> UserController:
        return UserController(self._current_session)

    @property
    def undercover_controller(self) -> UndercoverController:
        return UndercoverController(self._current_session)

    @property
    def codenames_controller(self) -> CodenamesController:
        return CodenamesController(self._current_session)

    @property
    def socket_room_controller(self):
        return self._socket_room_controller_cls(
            self.room_controller,
            self.game_controller,
            self.user_controller,
            self.undercover_controller,
        )


class RedisJsonModel(JsonModel):
    class Meta:
        database = redis_connection
