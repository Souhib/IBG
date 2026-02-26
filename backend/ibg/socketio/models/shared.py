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
    """Socket.IO server with per-event database session management.

    Controllers are lazily instantiated on first access to avoid creating
    all 5 controllers for every socket event when typically only 1-2 are used.
    """

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
        self._session: AsyncSession | None = None
        self._room_controller: RoomController | None = None
        self._game_controller: GameController | None = None
        self._user_controller: UserController | None = None
        self._undercover_controller: UndercoverController | None = None
        self._codenames_controller: CodenamesController | None = None
        self._socket_room_controller = None
        logger.info(f"[SIO] IBGSocket initialized with CORS origins: {allowed_origins}")

    async def create_session(self) -> AsyncSession:
        """Create a fresh async session for the current event.

        Resets all lazy controller references so they'll be created on demand.
        Returns the session so the caller can manage its lifecycle.
        """
        engine = await get_engine()
        session = AsyncSession(engine, expire_on_commit=False)
        self._session = session
        # Reset lazy controllers for this event
        self._room_controller = None
        self._game_controller = None
        self._user_controller = None
        self._undercover_controller = None
        self._codenames_controller = None
        self._socket_room_controller = None
        return session

    @property
    def room_controller(self) -> RoomController:
        if self._room_controller is None:
            self._room_controller = RoomController(self._session)  # type: ignore
        return self._room_controller

    @property
    def game_controller(self) -> GameController:
        if self._game_controller is None:
            self._game_controller = GameController(self._session)  # type: ignore
        return self._game_controller

    @property
    def user_controller(self) -> UserController:
        if self._user_controller is None:
            self._user_controller = UserController(self._session)  # type: ignore
        return self._user_controller

    @property
    def undercover_controller(self) -> UndercoverController:
        if self._undercover_controller is None:
            self._undercover_controller = UndercoverController(self._session)  # type: ignore
        return self._undercover_controller

    @property
    def codenames_controller(self) -> CodenamesController:
        if self._codenames_controller is None:
            self._codenames_controller = CodenamesController(self._session)  # type: ignore
        return self._codenames_controller

    @property
    def socket_room_controller(self):
        if self._socket_room_controller is None:
            self._socket_room_controller = self._socket_room_controller_cls(
                self.room_controller,
                self.game_controller,
                self.user_controller,
                self.undercover_controller,
            )
        return self._socket_room_controller


class RedisJsonModel(JsonModel):
    class Meta:
        database = redis_connection
