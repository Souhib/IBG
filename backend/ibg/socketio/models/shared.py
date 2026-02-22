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


class IBGSocket(socketio.AsyncServer):
    """Socket.IO server with per-event database session management."""

    def __init__(
        self,
        cors_origins: list[str] | None = None,
        ping_interval: int = 25,
        ping_timeout: int = 20,
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
        """Create a fresh async session and controllers for the current event.

        Returns the session so the caller can manage its lifecycle.
        """
        engine = await get_engine()
        session = AsyncSession(engine, expire_on_commit=False)
        self.room_controller = RoomController(session)
        self.game_controller = GameController(session)
        self.user_controller = UserController(session)
        self.undercover_controller = UndercoverController(session)
        self.codenames_controller = CodenamesController(session)
        self.socket_room_controller = self._socket_room_controller_cls(
            self.room_controller,
            self.game_controller,
            self.user_controller,
            self.undercover_controller,
        )
        return session


class RedisJsonModel(JsonModel):
    class Meta:
        database = redis_connection
