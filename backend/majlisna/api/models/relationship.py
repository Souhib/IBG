from datetime import datetime
from uuid import UUID

from sqlalchemy import Index
from sqlmodel import Field

from majlisna.api.models.shared import DBModel


class RoomUserLink(DBModel, table=True):
    __table_args__ = (
        Index("ix_roomuserlink_room_connected", "room_id", "connected"),
        Index("ix_roomuserlink_room_last_seen", "room_id", "last_seen_at"),
    )

    id: int | None = Field(default=None, primary_key=True)
    room_id: UUID | None = Field(default=None, foreign_key="room.id", index=True)
    user_id: UUID | None = Field(default=None, foreign_key="user.id", index=True)
    joined_at: datetime = Field(default_factory=datetime.now)
    connected: bool = True
    last_seen_at: datetime | None = None
    disconnected_at: datetime | None = None
    is_spectator: bool = False


class RoomGameLink(DBModel, table=True):
    room_id: UUID | None = Field(default=None, foreign_key="room.id", primary_key=True)
    game_id: UUID | None = Field(default=None, foreign_key="game.id", primary_key=True)


class UserGameLink(DBModel, table=True):
    user_id: UUID | None = Field(default=None, foreign_key="user.id", primary_key=True)
    game_id: UUID | None = Field(default=None, foreign_key="game.id", primary_key=True)


class GameTurnLink(DBModel, table=True):
    game_id: UUID | None = Field(default=None, foreign_key="game.id", primary_key=True)
    turn_id: UUID | None = Field(default=None, foreign_key="turn.id", primary_key=True)


class TurnEventLink(DBModel, table=True):
    turn_id: UUID | None = Field(default=None, foreign_key="turn.id", primary_key=True)
    event_id: UUID | None = Field(default=None, foreign_key="event.id", primary_key=True)


class RoomActivityLink(DBModel, table=True):
    activity_id: UUID | None = Field(default=None, foreign_key="activity.id", primary_key=True)
    room_id: UUID | None = Field(default=None, foreign_key="room.id", primary_key=True)
