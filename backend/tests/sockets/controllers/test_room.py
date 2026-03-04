"""Tests for SocketRoomController (user_join_room, user_leave_room, create_room, _update_game_sid).

Uses real Redis via testcontainers. DB controllers are mocked.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from ibg.api.models.error import RedisUnavailableError, RoomNotFoundError, UserAlreadyInRoomError, UserNotInRoomError
from ibg.api.models.room import RoomCreate
from ibg.socketio.controllers.room import SocketRoomController
from ibg.socketio.models.codenames import CodenamesGame, CodenamesRole, CodenamesTeam
from ibg.socketio.models.room import JoinRoomUser, LeaveRoomUser
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.socket import UndercoverGame
from ibg.socketio.models.user import User as RedisUser
from ibg.socketio.utils.disconnect_tasks import schedule_disconnect_cleanup
from tests.sockets.conftest import make_codenames_board, make_codenames_player, make_undercover_player


def _make_controller(
    room_controller=None,
    game_controller=None,
    user_controller=None,
    undercover_controller=None,
):
    """Create a SocketRoomController with mocked DB controllers."""
    return SocketRoomController(
        room_controller=room_controller or MagicMock(),
        game_controller=game_controller or MagicMock(),
        user_controller=user_controller or MagicMock(),
        undercover_controller=undercover_controller or MagicMock(),
    )


def _make_db_room(room_id=None, owner_id=None, public_id="ABCD"):
    """Create a MagicMock pretending to be a DB Room."""
    db_room = MagicMock()
    db_room.id = room_id or uuid4()
    db_room.owner_id = owner_id or uuid4()
    db_room.public_id = public_id
    db_room.users = []
    return db_room


def _make_db_user(user_id=None, username="testuser"):
    """Create a MagicMock pretending to be a DB User."""
    db_user = MagicMock()
    db_user.id = user_id or uuid4()
    db_user.username = username
    return db_user


# ========== user_join_room ==========


async def test_join_room_new_user_creates_redis_room(redis_cleanup):  # noqa: ARG001
    """Joining a room that doesn't exist in Redis creates it."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()

    room_ctrl = MagicMock()
    room_ctrl.get_active_room_by_public_id = AsyncMock(return_value=db_room)
    room_ctrl.join_room = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    join_data = JoinRoomUser(user_id=db_user.id, public_room_id="ABCD", password="1234")

    # Act
    result_room, is_reconnect = await controller.user_join_room("sid-1", join_data)

    # Assert
    assert is_reconnect is False
    assert result_room is db_room

    # Verify Redis room was created
    redis_room = await RedisRoom.get(str(db_room.id))
    assert redis_room.id == str(db_room.id)
    assert len(redis_room.users) == 1
    assert redis_room.users[0].id == str(db_user.id)


async def test_join_room_existing_redis_room_adds_user(make_redis_room):
    """Joining an existing Redis room adds the user to the room's user list."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()

    await make_redis_room(
        room_id=str(db_room.id),
        owner_id=str(db_room.owner_id),
    )

    room_ctrl = MagicMock()
    room_ctrl.get_active_room_by_public_id = AsyncMock(return_value=db_room)
    room_ctrl.join_room = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    join_data = JoinRoomUser(user_id=db_user.id, public_room_id="ABCD", password="1234")

    # Act
    _, is_reconnect = await controller.user_join_room("sid-1", join_data)

    # Assert
    assert is_reconnect is False
    redis_room = await RedisRoom.get(str(db_room.id))
    assert len(redis_room.users) == 1
    assert redis_room.users[0].sid == "sid-1"


async def test_join_room_existing_user_updates_sid(make_redis_room, make_redis_user):
    """If the user is already in the Redis room, their SID is updated."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()
    user_id_str = str(db_user.id)

    existing_user = await make_redis_user(user_id=user_id_str, username="test", sid="old-sid", room_id=str(db_room.id))
    await make_redis_room(room_id=str(db_room.id), users=[existing_user], owner_id=str(db_room.owner_id))

    room_ctrl = MagicMock()
    room_ctrl.get_active_room_by_public_id = AsyncMock(return_value=db_room)
    room_ctrl.join_room = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    join_data = JoinRoomUser(user_id=db_user.id, public_room_id="ABCD", password="1234")

    # Act
    _, is_reconnect = await controller.user_join_room("new-sid", join_data)

    # Assert
    assert is_reconnect is False
    redis_room = await RedisRoom.get(str(db_room.id))
    assert redis_room.users[0].sid == "new-sid"

    # Also verify the standalone Redis User was updated
    redis_user = await RedisUser.get(user_id_str)
    assert redis_user.sid == "new-sid"


async def test_join_room_user_already_in_room_db(make_redis_room):
    """If UserAlreadyInRoomError is raised by DB join, it's caught and room is re-fetched."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()

    await make_redis_room(room_id=str(db_room.id), owner_id=str(db_room.owner_id))

    room_ctrl = MagicMock()
    room_ctrl.get_active_room_by_public_id = AsyncMock(return_value=db_room)
    room_ctrl.join_room = AsyncMock(side_effect=UserAlreadyInRoomError(user_id=db_user.id, room_id=db_room.id))
    room_ctrl.get_room_by_id = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    join_data = JoinRoomUser(user_id=db_user.id, public_room_id="ABCD", password="1234")

    # Act — should not raise
    result_room, is_reconnect = await controller.user_join_room("sid-1", join_data)

    # Assert
    assert result_room is db_room
    room_ctrl.get_room_by_id.assert_awaited_once_with(db_room.id)


async def test_join_room_reconnection(make_redis_room, make_redis_user):
    """Reconnection is detected via cancel_disconnect_cleanup and clears disconnected_at."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()
    user_id_str = str(db_user.id)

    existing_user = await make_redis_user(user_id=user_id_str, username="test", sid="old-sid", room_id=str(db_room.id))
    await make_redis_room(
        room_id=str(db_room.id),
        users=[existing_user],
        owner_id=str(db_room.owner_id),
    )

    # Schedule a fake disconnect cleanup so cancel returns True
    await schedule_disconnect_cleanup(user_id_str, 60, room_id=str(db_room.id))

    room_ctrl = MagicMock()
    room_ctrl.get_active_room_by_public_id = AsyncMock(return_value=db_room)
    room_ctrl.join_room = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    join_data = JoinRoomUser(user_id=db_user.id, public_room_id="ABCD", password="1234")

    # Act
    _, is_reconnect = await controller.user_join_room("new-sid", join_data)

    # Assert
    assert is_reconnect is True
    # Activity event should say "reconnect"
    call_kwargs = room_ctrl.create_room_activity.call_args
    assert "reconnect" in call_kwargs.kwargs["activity_create"].name


# ========== user_leave_room ==========


async def test_leave_room_success(make_redis_room, make_redis_user):
    """User successfully leaves a room — removed from Redis room and user deleted."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()
    user_id_str = str(db_user.id)

    existing_user = await make_redis_user(user_id=user_id_str, username="test", sid="sid-1", room_id=str(db_room.id))
    await make_redis_room(room_id=str(db_room.id), users=[existing_user], owner_id=str(db_room.owner_id))

    room_ctrl = MagicMock()
    room_ctrl.leave_room = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    leave_data = LeaveRoomUser(user_id=db_user.id, room_id=db_room.id, username="test")

    # Act
    result = await controller.user_leave_room(leave_data)

    # Assert
    assert result is db_room
    redis_room = await RedisRoom.get(str(db_room.id))
    assert len(redis_room.users) == 0


async def test_leave_room_redis_room_not_found(redis_cleanup):  # noqa: ARG001
    """Raises RoomNotFoundError when the Redis room doesn't exist."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()

    room_ctrl = MagicMock()
    room_ctrl.leave_room = AsyncMock(return_value=db_room)

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    leave_data = LeaveRoomUser(user_id=db_user.id, room_id=db_room.id, username="test")

    # Act / Assert
    with pytest.raises(RoomNotFoundError):
        await controller.user_leave_room(leave_data)


async def test_leave_room_user_not_in_redis_room(make_redis_room):
    """Raises UserNotInRoomError when user is not in the Redis room's user list."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()

    await make_redis_room(room_id=str(db_room.id), owner_id=str(db_room.owner_id))

    room_ctrl = MagicMock()
    room_ctrl.leave_room = AsyncMock(return_value=db_room)

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    leave_data = LeaveRoomUser(user_id=db_user.id, room_id=db_room.id, username="test")

    # Act / Assert
    with pytest.raises(UserNotInRoomError):
        await controller.user_leave_room(leave_data)


# ========== create_room ==========


async def test_create_room_success(redis_cleanup):  # noqa: ARG001
    """Creating a room creates Redis user and Redis room."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()

    room_ctrl = MagicMock()
    room_ctrl.create_room = AsyncMock(return_value=db_room)

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    room_create = RoomCreate(owner_id=db_user.id, password="1234", status="online")

    # Act
    result = await controller.create_room("sid-1", room_create)

    # Assert
    assert result is db_room

    # Verify Redis objects created
    redis_room = await RedisRoom.get(str(db_room.id))
    assert redis_room.owner_id == str(db_room.owner_id)
    assert len(redis_room.users) == 1
    assert redis_room.users[0].sid == "sid-1"

    redis_user = await RedisUser.get(str(db_user.id))
    assert redis_user.room_id == str(db_room.id)


async def test_create_room_redis_failure_cleans_up_db(redis_cleanup):  # noqa: ARG001
    """When Redis fails during room creation, the DB room is deleted and RedisUnavailableError is raised."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()

    room_ctrl = MagicMock()
    room_ctrl.create_room = AsyncMock(return_value=db_room)
    room_ctrl.delete_room = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    room_create = RoomCreate(owner_id=db_user.id, password="1234", status="online")

    # Act / Assert — simulate Redis MISCONF error on User.save()
    with (
        patch.object(RedisUser, "save", side_effect=Exception("MISCONF Redis is configured to save RDB snapshots")),
        pytest.raises(RedisUnavailableError) as exc_info,
    ):
        await controller.create_room("sid-1", room_create)

    # Assert — DB room was cleaned up
    room_ctrl.delete_room.assert_awaited_once_with(db_room.id)
    assert "create_room" in exc_info.value.message
    assert "MISCONF" in exc_info.value.message


async def test_create_room_redis_room_save_failure_cleans_up(redis_cleanup):  # noqa: ARG001
    """When Redis Room save fails (but User save succeeds), DB room is still cleaned up."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()

    room_ctrl = MagicMock()
    room_ctrl.create_room = AsyncMock(return_value=db_room)
    room_ctrl.delete_room = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    room_create = RoomCreate(owner_id=db_user.id, password="1234", status="online")

    # Act / Assert — Redis User.save() succeeds, but RedisRoom.save() fails
    with (
        patch.object(RedisRoom, "save", side_effect=Exception("MISCONF Redis RDB snapshot error")),
        pytest.raises(RedisUnavailableError),
    ):
        await controller.create_room("sid-1", room_create)

    # Assert — DB room was cleaned up despite partial Redis success
    room_ctrl.delete_room.assert_awaited_once_with(db_room.id)


# ========== _update_game_sid ==========


async def test_update_game_sid_undercover(make_redis_room, make_undercover_game):
    """Reconnecting updates player SID in an active undercover game."""

    # Arrange
    user_id = "11111111-1111-1111-1111-111111111111"
    room_id = "room-sid-1"
    game_id = "game-sid-1"

    await make_undercover_game(
        game_id=game_id, room_id=room_id,
        players=[make_undercover_player(user_id)],
    )
    redis_room = await make_redis_room(
        room_id=room_id,
        active_game_id=game_id,
        active_game_type="undercover",
    )

    controller = _make_controller()

    # Act
    await controller._update_game_sid(redis_room, user_id, "new-sid")

    # Assert
    game = await UndercoverGame.get(game_id)
    player = next(p for p in game.players if str(p.user_id) == user_id)
    assert player.sid == "new-sid"


async def test_update_game_sid_codenames(make_redis_room, make_codenames_game):
    """Reconnecting updates player SID in an active codenames game."""

    # Arrange
    user_id = "11111111-1111-1111-1111-111111111111"
    room_id = "room-sid-2"
    game_id = "game-sid-2"

    await make_codenames_game(
        game_id=game_id, room_id=room_id,
        board=make_codenames_board(),
        players=[make_codenames_player(user_id, CodenamesTeam.RED, CodenamesRole.SPYMASTER)],
    )
    redis_room = await make_redis_room(
        room_id=room_id,
        active_game_id=game_id,
        active_game_type="codenames",
    )

    controller = _make_controller()

    # Act
    await controller._update_game_sid(redis_room, user_id, "new-sid")

    # Assert
    game = await CodenamesGame.get(game_id)
    player = next(p for p in game.players if str(p.user_id) == user_id)
    assert player.sid == "new-sid"


async def test_update_game_sid_game_not_found(make_redis_room):
    """If the game is not found in Redis, the error is logged and no exception raised."""

    # Arrange
    redis_room = await make_redis_room(
        room_id="room-sid-3",
        active_game_id="nonexistent-game",
        active_game_type="undercover",
    )

    controller = _make_controller()

    # Act — should not raise
    await controller._update_game_sid(redis_room, "some-user-id", "new-sid")


async def test_update_game_sid_player_not_in_game(make_redis_room, make_undercover_game):
    """If the player is not in the game, the function completes without error."""

    # Arrange
    room_id = "room-sid-4"
    game_id = "game-sid-4"
    existing_user = "11111111-1111-1111-1111-111111111111"
    missing_user = "22222222-2222-2222-2222-222222222222"

    await make_undercover_game(
        game_id=game_id, room_id=room_id,
        players=[make_undercover_player(existing_user)],
    )
    redis_room = await make_redis_room(
        room_id=room_id,
        active_game_id=game_id,
        active_game_type="undercover",
    )

    controller = _make_controller()

    # Act — missing_user is not in the game, should not raise
    await controller._update_game_sid(redis_room, missing_user, "new-sid")

    # Assert — existing player's SID unchanged
    game = await UndercoverGame.get(game_id)
    player = next(p for p in game.players if str(p.user_id) == existing_user)
    assert player.sid == f"sid-{existing_user[:8]}"  # original from make_undercover_player


async def test_join_room_no_standalone_redis_user(make_redis_room):
    """When user is in redis_room.users but no standalone User record exists,
    user_join_room creates the standalone User (covers lines 113-122)."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()
    user_id_str = str(db_user.id)

    # Embed user in the room's users list WITHOUT creating a standalone User record
    embedded = RedisUser(pk=user_id_str, id=user_id_str, username="test", sid="old-sid", room_id=str(db_room.id))
    await make_redis_room(room_id=str(db_room.id), users=[embedded], owner_id=str(db_room.owner_id))

    room_ctrl = MagicMock()
    room_ctrl.get_active_room_by_public_id = AsyncMock(return_value=db_room)
    room_ctrl.join_room = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    join_data = JoinRoomUser(user_id=db_user.id, public_room_id="ABCD", password="1234")

    # Act
    await controller.user_join_room("new-sid", join_data)

    # Assert — standalone Redis User should have been created
    redis_user = await RedisUser.get(user_id_str)
    assert redis_user.sid == "new-sid"
    assert redis_user.room_id == str(db_room.id)


async def test_leave_room_no_standalone_redis_user(make_redis_room):
    """When user is in redis_room.users but no standalone User record exists,
    user_leave_room catches NotFoundError silently (covers lines 201-202)."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()
    user_id_str = str(db_user.id)

    # Embed user in the room without standalone User
    embedded = RedisUser(pk=user_id_str, id=user_id_str, username="test", sid="old-sid", room_id=str(db_room.id))
    await make_redis_room(room_id=str(db_room.id), users=[embedded], owner_id=str(db_room.owner_id))

    room_ctrl = MagicMock()
    room_ctrl.leave_room = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    leave_data = LeaveRoomUser(user_id=db_user.id, room_id=db_room.id, username="test")

    # Act — should not raise even though standalone User doesn't exist
    result = await controller.user_leave_room(leave_data)

    # Assert
    assert result is db_room
    redis_room = await RedisRoom.get(str(db_room.id))
    assert len(redis_room.users) == 0


async def test_join_room_reconnect_updates_game_sid(make_redis_room, make_redis_user, make_undercover_game):
    """On reconnect with active game, SID is updated in the game model too."""

    # Arrange
    db_room = _make_db_room()
    db_user = _make_db_user()
    user_id_str = str(db_user.id)
    game_id = "game-reconnect-sid"

    await make_undercover_game(
        game_id=game_id, room_id=str(db_room.id),
        players=[make_undercover_player(user_id_str)],
    )

    existing_user = await make_redis_user(user_id=user_id_str, username="test", sid="old-sid", room_id=str(db_room.id))
    await make_redis_room(
        room_id=str(db_room.id),
        users=[existing_user],
        owner_id=str(db_room.owner_id),
        active_game_id=game_id,
        active_game_type="undercover",
    )

    # Schedule a fake disconnect cleanup so cancel returns True
    await schedule_disconnect_cleanup(user_id_str, 60, room_id=str(db_room.id))

    room_ctrl = MagicMock()
    room_ctrl.get_active_room_by_public_id = AsyncMock(return_value=db_room)
    room_ctrl.join_room = AsyncMock(return_value=db_room)
    room_ctrl.create_room_activity = AsyncMock()

    user_ctrl = MagicMock()
    user_ctrl.get_user_by_id = AsyncMock(return_value=db_user)

    controller = _make_controller(room_controller=room_ctrl, user_controller=user_ctrl)

    join_data = JoinRoomUser(user_id=db_user.id, public_room_id="ABCD", password="1234")

    # Act
    _, is_reconnect = await controller.user_join_room("new-sid", join_data)

    # Assert
    assert is_reconnect is True

    # Game SID should be updated
    game = await UndercoverGame.get(game_id)
    player = next(p for p in game.players if str(p.user_id) == user_id_str)
    assert player.sid == "new-sid"
