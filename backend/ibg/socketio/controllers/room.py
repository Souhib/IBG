from aredis_om import NotFoundError
from loguru import logger

from ibg.api.controllers.game import GameController
from ibg.api.controllers.room import RoomController
from ibg.api.controllers.undercover import UndercoverController
from ibg.api.controllers.user import UserController
from ibg.api.models.error import RedisUnavailableError, RoomNotFoundError, UserAlreadyInRoomError, UserNotInRoomError
from ibg.api.models.event import EventCreate
from ibg.api.models.room import RoomCreate, RoomJoin, RoomLeave
from ibg.api.models.table import Room
from ibg.socketio.models.codenames import CodenamesGame
from ibg.socketio.models.room import JoinRoomUser, LeaveRoomUser
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.shared import redis_connection
from ibg.socketio.models.socket import UndercoverGame
from ibg.socketio.models.user import User
from ibg.socketio.utils.disconnect_tasks import cancel_disconnect_cleanup
from ibg.socketio.utils.redis_ttl import refresh_room_ttl, refresh_user_ttl


class SocketRoomController:
    def __init__(
        self,
        room_controller: RoomController,
        game_controller: GameController,
        user_controller: UserController,
        undercover_controller: UndercoverController,
    ):
        self._room_controller = room_controller
        self._game_controller = game_controller
        self._user_controller = user_controller
        self._undercover_controller = undercover_controller

    async def user_join_room(self, sid: str, join_room_user: JoinRoomUser) -> tuple[Room, bool]:
        """
        Join a user to a room. If the room does not exist, raise a RoomNotFoundError.
        Creates Redis room if it doesn't exist (room was created via REST).
        Skips DB join if user was already added via REST room creation.

        Detects reconnection: if a pending disconnect cleanup exists for the user,
        cancels it and returns is_reconnect=True.

        Uses a Redis distributed lock to prevent race conditions on concurrent joins.

        :param sid: The socket id of the user.
        :param join_room_user: The user to join the room.
        :return: Tuple of (room, is_reconnect).
        """
        db_room = await self._room_controller.get_active_room_by_public_id(join_room_user.public_room_id)
        db_user = await self._user_controller.get_user_by_id(join_room_user.user_id)

        # Check if this is a reconnect (cancel pending disconnect cleanup)
        is_reconnect = cancel_disconnect_cleanup(str(db_user.id))
        if is_reconnect:
            logger.info(f"[Room] Reconnect detected for user_id={db_user.id}")

        # Join DB room (skip if user already joined via REST room creation)
        try:
            db_room = await self._room_controller.join_room(
                RoomJoin(
                    room_id=db_room.id,
                    user_id=join_room_user.user_id,
                    password=join_room_user.password,
                )
            )
        except UserAlreadyInRoomError:
            db_room = await self._room_controller.get_room_by_id(db_room.id)

        # Atomic Redis room update with distributed lock
        async with redis_connection.lock(f"room:{db_room.id}:join", timeout=5):
            # Get or create Redis room (REST creation doesn't create one)
            try:
                redis_room = await RedisRoom.get(str(db_room.id))
            except NotFoundError:
                redis_room = RedisRoom(
                    pk=str(db_room.id),
                    id=str(db_room.id),
                    public_id=str(db_room.public_id),
                    users=[],
                    owner_id=str(db_room.owner_id),
                )
                await redis_room.save()

            # Add to Redis room or update SID if already there
            existing_user = next((u for u in redis_room.users if u.id == str(db_user.id)), None)
            if existing_user:
                existing_user.sid = sid
                existing_user.disconnected_at = None  # Clear disconnect timestamp
                existing_user.room_id = str(db_room.id)
                await redis_room.save()
            else:
                user = User(
                    pk=str(db_user.id),
                    id=str(db_user.id),
                    username=db_user.username,
                    sid=sid,
                    room_id=str(db_room.id),
                )
                await user.save()
                await refresh_user_ttl(user)
                redis_room.users.append(user)
                await redis_room.save()
            await refresh_room_ttl(redis_room)

        # Update Redis User model (SID, clear disconnect, set room_id)
        try:
            redis_user = await User.get(str(db_user.id))
            redis_user.sid = sid
            redis_user.disconnected_at = None
            redis_user.room_id = str(db_room.id)
            await redis_user.save()
            await refresh_user_ttl(redis_user)
        except NotFoundError:
            redis_user = User(
                pk=str(db_user.id),
                id=str(db_user.id),
                username=db_user.username,
                sid=sid,
                room_id=str(db_room.id),
            )
            await redis_user.save()
            await refresh_user_ttl(redis_user)

        # If reconnecting, update SID in active game models
        if is_reconnect and redis_room.active_game_id:
            await self._update_game_sid(redis_room, str(db_user.id), sid)

        await self._room_controller.create_room_activity(
            room_id=db_room.id,
            activity_create=EventCreate(
                name="reconnect" if is_reconnect else "join_room",
                data={
                    "user_id": str(db_user.id),
                    "username": db_user.username,
                    "message": (
                        f"User {db_user.username} reconnected to room {str(db_room.id)}."
                        if is_reconnect
                        else f"User {db_user.username} joined the room {str(db_room.id)}."
                    ),
                },
                user_id=db_user.id,
            ),
        )
        return db_room, is_reconnect

    async def _update_game_sid(self, redis_room: RedisRoom, user_id: str, new_sid: str) -> None:
        """Update the SID for a player in an active game after reconnection."""
        try:
            if redis_room.active_game_type == "undercover":
                game = await UndercoverGame.get(redis_room.active_game_id)
                for player in game.players:
                    if str(player.user_id) == user_id:
                        player.sid = new_sid
                        await game.save()
                        break
            elif redis_room.active_game_type == "codenames":
                game = await CodenamesGame.get(redis_room.active_game_id)
                for player in game.players:
                    if str(player.user_id) == user_id:
                        player.sid = new_sid
                        await game.save()
                        break
        except NotFoundError:
            logger.warning(f"[Room] Could not update SID in game {redis_room.active_game_id} for user {user_id}")

    async def user_leave_room(self, leave_room_user: LeaveRoomUser) -> Room:
        """
        Leave a user from a room. If the room does not exist, raise a RoomNotFoundError.
        If the user is not in the room, raise a UserNotInRoomError.

        Uses a Redis distributed lock to prevent race conditions on concurrent leaves.

        :param leave_room_user: The user to leave the room.
        :return: The DB room with relationships loaded.
        """
        db_user = await self._user_controller.get_user_by_id(leave_room_user.user_id)
        db_room = await self._room_controller.leave_room(
            RoomLeave(room_id=leave_room_user.room_id, user_id=leave_room_user.user_id)
        )

        # Atomic Redis room update with distributed lock
        async with redis_connection.lock(f"room:{leave_room_user.room_id}:leave", timeout=5):
            try:
                redis_room = await RedisRoom.get(str(leave_room_user.room_id))
            except NotFoundError:
                raise RoomNotFoundError(room_id=leave_room_user.room_id)

            if not any(user.id == str(db_user.id) for user in redis_room.users):
                raise UserNotInRoomError(user_id=leave_room_user.user_id, room_id=leave_room_user.room_id)

            # Remove user from Redis room
            redis_room.users = [u for u in redis_room.users if u.id != str(db_user.id)]
            await redis_room.save()
            await refresh_room_ttl(redis_room)

        try:
            redis_user = await User.get(str(db_user.id))
            redis_user.room_id = None
            await redis_user.save()
            await User.delete(redis_user.pk)
        except NotFoundError:
            pass

        await self._room_controller.create_room_activity(
            room_id=leave_room_user.room_id,
            activity_create=EventCreate(
                name="leave_room",
                data={
                    "user_id": str(db_user.id),
                    "username": db_user.username,
                    "message": f"User {db_user.username} left the room {db_room.id}.",
                },
                user_id=db_user.id,
            ),
        )
        return db_room

    async def create_room(self, sid, room_create: RoomCreate) -> Room:
        """
        Create a room with the given room_id. If the room already exists, raise a RoomAlreadyExistsError.

        If Redis is unavailable after DB room creation, cleans up the DB room
        to avoid orphaned records and raises RedisUnavailableError.

        :param sid: The socket id of the user.
        :param room_create: The room to create.
        :return: Room
        """
        db_user = await self._user_controller.get_user_by_id(room_create.owner_id)
        db_room = await self._room_controller.create_room(room_create)
        try:
            redis_user = User(
                pk=str(db_user.id),
                id=str(db_user.id),
                username=db_user.username,
                sid=sid,
                room_id=str(db_room.id),
            )
            await redis_user.save()
            await refresh_user_ttl(redis_user)
            redis_room = RedisRoom(
                pk=str(db_room.id),
                id=str(db_room.id),
                public_id=str(db_room.public_id),
                users=[redis_user],
                owner_id=str(db_room.owner_id),
            )
            await redis_room.save()
            await refresh_room_ttl(redis_room)
        except Exception as e:
            logger.error(f"[Room] Redis failed during create_room for room_id={db_room.id}: {e}")
            await self._room_controller.delete_room(db_room.id)
            raise RedisUnavailableError(operation="create_room", original_error=str(e)) from e
        return db_room
