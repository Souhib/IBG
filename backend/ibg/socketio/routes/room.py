import time
from uuid import UUID

from aredis_om import NotFoundError
from fastapi import APIRouter
from jose import JWTError, jwt
from loguru import logger
from sqlmodel import select
from starlette.responses import HTMLResponse

from ibg.api.constants import (
    DISCONNECT_GRACE_PERIOD_SECONDS,
    EVENT_OWNER_CHANGED,
    EVENT_PLAYER_DISCONNECTED,
    EVENT_PLAYER_LEFT_PERMANENTLY,
    EVENT_PLAYER_RECONNECTED,
)
from ibg.api.models.relationship import RoomUserLink
from ibg.api.models.room import RoomCreate, RoomType
from ibg.api.models.table import Room as DBRoom
from ibg.api.models.view import RoomView
from ibg.socketio.controllers.disconnect import handle_codenames_disconnect, handle_undercover_disconnect
from ibg.socketio.dependencies import get_settings_singleton
from ibg.socketio.models.codenames import CodenamesGame
from ibg.socketio.models.room import JoinRoomUser, LeaveRoomUser
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.shared import IBGSocket
from ibg.socketio.models.socket import UndercoverGame
from ibg.socketio.models.user import User
from ibg.socketio.routes.shared import (
    cleanup_sid_counter,
    send_event_to_client,
    serialize_model,
    socketio_exception_handler,
)
from ibg.socketio.utils.disconnect_tasks import schedule_disconnect_cleanup
from ibg.socketio.utils.redis_ttl import set_game_finished_ttl

router = APIRouter(
    responses={404: {"description": "Not found"}},
)


test = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Socket.IO Room Management</title>
    <script src="https://cdn.socket.io/4.4.1/socket.io.min.js"></script>
    <script>
    document.addEventListener('DOMContentLoaded', () => {
        const urlParams = new URLSearchParams(window.location.search);
        const user_id = urlParams.get('user_id') || generateUUID();
        const room_id = urlParams.get('room_id') || generateUUID();
        const sid = urlParams.get('sid') || generateUUID();

        const socket = io('http://127.0.0.1:5000/');
        const joinRoomButton = document.getElementById('joinRoom');
        const createRoomButton = document.getElementById('createRoom');
        const leaveRoomButton = document.getElementById('leaveRoom');
        const startGameButton = document.getElementById('startGame');
        const voteButton = document.getElementById('voteButton');
        const roomInput = document.getElementById('roomInput');
        const passwordInput = document.getElementById('passwordInput');
        const playersSelect = document.getElementById('playersSelect');

        function generateUUID() {
            return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
            );
        }

        joinRoomButton.addEventListener('click', () => {
            const room = roomInput.value || room_id;
            const password = passwordInput.value;
            console.log(`User ID: ${user_id}`);
            socket.emit('join_room', {
                public_room_id: room,
                user_id: user_id,
                password: password
            });
            console.log(`Requested to join room ${room}`);
        });

        createRoomButton.addEventListener('click', () => {
            // const room = roomInput.value || room_id;
            const password = passwordInput.value;
            socket.emit('create_room', {
                owner_id: user_id,
                status: 'online',
                password: password
            });
            console.log(`Requested to create and join room with password ${password}`);
        });

        leaveRoomButton.addEventListener('click', () => {
            const room = roomInput.value || room_id;
            socket.emit('leave_room', {
                room_id: room,
                user_id: user_id,
            });
            console.log(`Requested to leave room ${room}`);
        });

        startGameButton.addEventListener('click', () => {
            const room = roomInput.value || room_id;
            socket.emit('start_undercover_game', {
                room_id: room,
                user_id: user_id
            });
            console.log(`Requested to start game in room ${room}`);
        });

        voteButton.addEventListener('click', () => {
            const voted_user_id = playersSelect.value;
            if (voted_user_id) {
                socket.emit('vote_for_a_player', {
                    user_id: user_id,
                    voted_user_id: voted_user_id,
                    game_id: room_id,
                });
                console.log(`Voted for player ${voted_user_id}`);
            } else {
                console.log('No player selected to vote for.');
            }
        });

        socket.on('room_status', (data) => {
            console.log(data.data);
            document.getElementById('status').textContent = data.data;
        });

        socket.on('notification', (data) => {
            console.log(data.data);
            const messages = document.getElementById('messages');
            messages.textContent += `${data.data}\\n`;
        });

        socket.on('game_started', (data) => {
            console.log('Game started:', data);
            let players = data.players;
            playersSelect.innerHTML = '';
            players.forEach(player => {
                if (player !== user_id) {
                    let option = new Option(player, player);
                    playersSelect.add(option);
                }
            });
            document.getElementById('votingSection').style.display = 'block';
        });
    });
    </script>
</head>
<body>
    <h1>Socket.IO Room Management</h1>
    <input type="text" id="roomInput" placeholder="Room ID">
    <input type="password" id="passwordInput" placeholder="Room Password">
    <button id="joinRoom">Join Room</button>
    <button id="createRoom">Create Room</button>
    <button id="leaveRoom">Leave Room</button>
    <button id="startGame">Start Game</button>
    <div id="status"></div>
    <pre id="messages"></pre>
    <div id="votingSection" style="display:none;">
        <h2>Vote for a Player</h2>
        <select id="playersSelect">
            <option value="">Select a player to vote for</option>
        </select>
        <button id="voteButton">Vote</button>
    </div>
</body>
</html>
"""


def _decode_jwt(token: str) -> dict:
    """Decode and validate a JWT token for Socket.IO authentication.

    :param token: The JWT token string.
    :return: The decoded payload dict.
    :raises JWTError: If the token is invalid or expired.
    """
    settings = get_settings_singleton()
    return jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_encryption_algorithm],
    )


@router.get("/site", response_class=HTMLResponse)
def get_website():
    return HTMLResponse(content=test, status_code=200)


def room_events(sio: IBGSocket) -> None:

    @sio.event
    async def connect(sid, environ, auth):
        """Authenticate Socket.IO connections via JWT in handshake auth."""
        if not auth or "token" not in auth:
            logger.warning(f"[SIO] Connection rejected: no token (sid={sid})")
            return False
        try:
            payload = _decode_jwt(auth["token"])
            user_id = payload.get("sub")
            if not user_id:
                logger.warning(f"[SIO] Connection rejected: no sub in token (sid={sid})")
                return False
            await sio.save_session(sid, {"user_id": user_id})
            logger.info(f"[SIO] Connected: sid={sid}, user_id={user_id}")
        except JWTError as e:
            logger.warning(f"[SIO] Connection rejected: invalid token (sid={sid}, error={e})")
            return False

    @sio.event
    async def disconnect(sid):
        """Handle client disconnect with a grace period for reconnection.

        Instead of immediately removing the user, marks them as disconnected
        and schedules a delayed cleanup. If the user reconnects within
        DISCONNECT_GRACE_PERIOD_SECONDS, the cleanup is cancelled.
        """
        session = await sio.get_session(sid)
        user_id = session.get("user_id") if session else None
        if not user_id:
            logger.info(f"[SIO] Disconnected unknown user: sid={sid}")
            return

        logger.info(f"[SIO] Disconnected: sid={sid}, user_id={user_id}")
        cleanup_sid_counter(sid)

        # Look up the Redis user to get their room_id directly
        try:
            redis_user = await User.get(user_id)
        except NotFoundError:
            logger.info(f"[SIO] No Redis user found for user_id={user_id}, nothing to clean up")
            return

        room_id = redis_user.room_id
        if not room_id:
            logger.info(f"[SIO] User {user_id} has no room_id, cleaning up user model only")
            await User.delete(redis_user.pk)
            return

        # Mark user as disconnected (don't remove yet)
        redis_user.disconnected_at = time.time()
        await redis_user.save()

        # Find the room and notify
        try:
            redis_room = await RedisRoom.get(room_id)
        except NotFoundError:
            logger.warning(f"[SIO] Room {room_id} not found during disconnect for user_id={user_id}")
            await User.delete(redis_user.pk)
            return

        # Update user's disconnected_at in the room's user list too
        user_in_room = next((u for u in redis_room.users if u.id == user_id), None)
        if user_in_room:
            user_in_room.disconnected_at = redis_user.disconnected_at
            await redis_room.save()

        # Leave the Socket.IO room (transport is gone)
        await sio.leave_room(sid, redis_room.id)

        # Notify remaining room members of temporary disconnect
        in_game = redis_room.active_game_id is not None
        await send_event_to_client(
            sio,
            EVENT_PLAYER_DISCONNECTED,
            {
                "user_id": user_id,
                "username": redis_user.username,
                "in_game": in_game,
                "grace_period_seconds": DISCONNECT_GRACE_PERIOD_SECONDS,
                "message": f"User {redis_user.username} has disconnected. Waiting for reconnect...",
            },
            room=redis_room.public_id,
        )

        # Schedule permanent cleanup after grace period
        schedule_disconnect_cleanup(
            user_id,
            DISCONNECT_GRACE_PERIOD_SECONDS,
            _permanent_disconnect_cleanup(sio, user_id, room_id),
        )

    async def _permanent_disconnect_cleanup(sio: IBGSocket, user_id: str, room_id: str) -> None:
        """Permanently remove a user who didn't reconnect within the grace period.

        Handles: Redis user deletion, room removal, game-specific cleanup,
        owner transfer, empty room deactivation, and DB updates.
        """
        logger.info(f"[Disconnect] Permanent cleanup for user_id={user_id}, room_id={room_id}")

        # Create a DB session for this background task
        db_session = await sio.create_session()

        try:
            # Get the Redis user (may already be gone if they reconnected then left normally)
            try:
                redis_user = await User.get(user_id)
            except NotFoundError:
                logger.info(f"[Disconnect] User {user_id} already cleaned up, skipping")
                return

            # Verify user is still disconnected (not reconnected)
            if redis_user.disconnected_at is None:
                logger.info(f"[Disconnect] User {user_id} reconnected, skipping cleanup")
                return

            # Delete the Redis User model
            await User.delete(redis_user.pk)

            # Get the Redis room
            try:
                redis_room = await RedisRoom.get(room_id)
            except NotFoundError:
                logger.info(f"[Disconnect] Room {room_id} already gone, skipping")
                return

            # Handle game-specific disconnect if there's an active game
            if redis_room.active_game_id:
                if redis_room.active_game_type == "undercover":
                    await handle_undercover_disconnect(sio, user_id, redis_room)
                elif redis_room.active_game_type == "codenames":
                    await handle_codenames_disconnect(sio, user_id, redis_room)

            # Remove user from Redis room
            redis_room.users = [u for u in redis_room.users if u.id != user_id]

            # Owner transfer logic
            was_owner = redis_room.owner_id == user_id
            if was_owner:
                # Find next connected user to become owner
                connected_users = [u for u in redis_room.users if u.disconnected_at is None]
                if connected_users:
                    new_owner = connected_users[0]
                    redis_room.owner_id = new_owner.id
                    await redis_room.save()

                    # Update DB room owner
                    try:
                        db_room = (await db_session.exec(select(DBRoom).where(DBRoom.id == UUID(room_id)))).first()
                        if db_room:
                            db_room.owner_id = UUID(new_owner.id)
                            db_session.add(db_room)
                            await db_session.commit()
                    except Exception:
                        logger.exception(f"[Disconnect] Failed to update DB owner for room {room_id}")

                    await send_event_to_client(
                        sio,
                        EVENT_OWNER_CHANGED,
                        {
                            "new_owner_id": new_owner.id,
                            "new_owner_username": new_owner.username,
                            "message": f"{new_owner.username} is now the room owner.",
                        },
                        room=redis_room.public_id,
                    )
                elif not redis_room.users:
                    # Room is empty — deactivate
                    await _deactivate_room(db_session, redis_room)
                    return
                else:
                    # All remaining users are also disconnected, pick first one
                    new_owner = redis_room.users[0]
                    redis_room.owner_id = new_owner.id
                    await redis_room.save()
            else:
                await redis_room.save()

            # If room is now empty, deactivate
            if not redis_room.users:
                await _deactivate_room(db_session, redis_room)
                return

            # Update RoomUserLink.connected = False in DB
            try:
                link = (
                    await db_session.exec(
                        select(RoomUserLink)
                        .where(RoomUserLink.room_id == UUID(room_id))
                        .where(RoomUserLink.user_id == UUID(user_id))
                        .where(RoomUserLink.connected == True)  # noqa: E712
                    )
                ).first()
                if link:
                    link.connected = False
                    db_session.add(link)
                    await db_session.commit()
            except Exception:
                logger.exception(f"[Disconnect] Failed to update RoomUserLink for user {user_id}")

            # Notify remaining players
            await send_event_to_client(
                sio,
                EVENT_PLAYER_LEFT_PERMANENTLY,
                {
                    "user_id": user_id,
                    "username": redis_user.username,
                    "message": f"{redis_user.username} has left the room.",
                },
                room=redis_room.public_id,
            )

        except Exception:
            logger.exception(f"[Disconnect] Error during permanent cleanup for user_id={user_id}")
        finally:
            await db_session.close()

    async def _deactivate_room(db_session, redis_room: RedisRoom) -> None:
        """Deactivate an empty room in both Redis and DB."""
        logger.info(f"[Disconnect] Room {redis_room.id} is empty, deactivating")

        # If there's an active game, set TTL on it
        if redis_room.active_game_id:
            try:
                if redis_room.active_game_type == "undercover":
                    game = await UndercoverGame.get(redis_room.active_game_id)
                    await set_game_finished_ttl(game)
                elif redis_room.active_game_type == "codenames":
                    game = await CodenamesGame.get(redis_room.active_game_id)
                    await set_game_finished_ttl(game)
            except NotFoundError:
                pass

        # Delete Redis room
        await RedisRoom.delete(redis_room.pk)

        # Set DB room to INACTIVE
        try:
            db_room = (await db_session.exec(select(DBRoom).where(DBRoom.id == UUID(redis_room.id)))).first()
            if db_room:
                db_room.type = RoomType.INACTIVE
                db_session.add(db_room)
                await db_session.commit()
        except Exception:
            logger.exception(f"[Disconnect] Failed to deactivate DB room {redis_room.id}")

    @sio.event
    @socketio_exception_handler(sio)
    async def join_room(sid, data) -> None:
        # Validation
        join_room_user = JoinRoomUser(**data)

        # Function Logic
        room, is_reconnect = await sio.socket_room_controller.user_join_room(sid, join_room_user)
        await sio.enter_room(sid=sid, room=room.public_id)

        room_view = serialize_model(RoomView.model_validate(room))

        if is_reconnect:
            # Send reconnect acknowledgement to the reconnecting user
            await send_event_to_client(
                sio,
                "room_status",
                {
                    "user_id": str(join_room_user.user_id),
                    "username": room.users[-1].username,
                    "message": f"You reconnected to room {room.public_id}.",
                    "data": room_view,
                },
                room=sid,
            )

            # Notify room that user has reconnected
            await send_event_to_client(
                sio,
                EVENT_PLAYER_RECONNECTED,
                {
                    "user_id": str(join_room_user.user_id),
                    "username": room.users[-1].username,
                    "message": f"User {room.users[-1].username} has reconnected.",
                    "data": room_view,
                },
                room=str(room.public_id),
            )
        else:
            # Send Notification to the user that they have joined
            await send_event_to_client(
                sio,
                "room_status",
                {
                    "user_id": str(join_room_user.user_id),
                    "username": room.users[-1].username,
                    "message": f"You joined the room {room.public_id}.",
                    "data": room_view,
                },
                room=sid,
            )

            # Send Notification to Room that user has joined
            await send_event_to_client(
                sio,
                "new_user_joined",
                {
                    "user_id": str(join_room_user.user_id),
                    "username": room.users[-1].username,
                    "message": f"User {sid} has joined the room.",
                    "data": room_view,
                },
                room=str(room.public_id),
            )

    @sio.event
    @socketio_exception_handler(sio)
    async def create_room(sid, data) -> None:
        # Validation
        create_room_user = RoomCreate(**data)

        # Function Logic
        room = await sio.socket_room_controller.create_room(sid, create_room_user)
        await sio.enter_room(sid, room.public_id)

        room_view = serialize_model(RoomView.model_validate(room))

        # Send Notification to the user that they have joined
        await send_event_to_client(
            sio,
            "new_room_created",
            {"message": f"Room {room.id} created.", "data": room_view},
            room=sid,
        )

    @sio.event
    @socketio_exception_handler(sio)
    async def leave_room(sid, data) -> None:
        # Validation
        leave_room_user = LeaveRoomUser(**data)

        # Function Logic
        room = await sio.socket_room_controller.user_leave_room(leave_room_user)
        await sio.leave_room(sid, room.public_id)

        room_view = serialize_model(RoomView.model_validate(room))

        # Send Notification to the user that they have left
        await send_event_to_client(
            sio,
            "you_left",
            {
                "user_id": str(leave_room_user.user_id),
                "username": leave_room_user.username,
                "message": f"You left the room {room.public_id}.",
            },
            room=sid,
        )

        # Send Notification to Room that user has left
        await send_event_to_client(
            sio,
            "user_left",
            {
                "user_id": str(leave_room_user.user_id),
                "username": leave_room_user.username,
                "message": f"User {leave_room_user.username} has left the room.",
                "data": room_view,
            },
            room=str(room.public_id),
        )
