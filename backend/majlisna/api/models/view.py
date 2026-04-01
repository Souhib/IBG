from datetime import datetime
from uuid import UUID

from majlisna.api.models.event import TurnBase
from majlisna.api.models.game import GameBase
from majlisna.api.models.room import RoomBase, RoomType
from majlisna.api.models.table import Event, Game, Room, Turn, User
from majlisna.api.models.user import UserBase


class TurnView(TurnBase):
    id: UUID
    game_id: UUID
    game: Game
    events: list[Event]


class GameView(GameBase):
    id: UUID
    room_id: UUID
    user_id: UUID
    room: Room
    users: list[User]
    turns: list[Turn]


class UserView(UserBase):
    id: UUID


class RoomView(RoomBase):
    id: UUID
    public_id: str
    owner_id: UUID
    password: str
    created_at: datetime
    type: RoomType
    users: list[UserView] = []
    games: list[Game] = []
