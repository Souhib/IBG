from uuid import UUID

from aredis_om import Field as RedisField
from pydantic import BaseModel, Field, field_validator

from ibg.socketio.models.shared import RedisJsonModel
from ibg.socketio.models.socket import Game
from ibg.socketio.models.user import User


class EventRoom(BaseModel):
    user_id: UUID
    room_id: UUID
    username: str


class JoinRoomUser(BaseModel):
    user_id: UUID
    public_room_id: str
    password: str = Field(min_length=4, max_length=4)

    @field_validator("password")
    @classmethod
    def check_password_only_digits(cls, v: str) -> str:
        """
        It checks that the password only contains digits
        :param v: The value to be validated
        :return: The room
        """
        if not v.isdigit():
            raise ValueError("Password must only contain digits")
        return v


class LeaveRoomUser(EventRoom):
    pass


class Room(RedisJsonModel, index=True):
    id: str = RedisField(index=True)
    public_id: str = ""
    users: list[User] = []
    games: list[Game] = []
    owner_id: str | None = None
    active_game_id: str | None = None
    active_game_type: str | None = None
