from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field

from majlisna.api.models.shared import DBModel


class EventBase(DBModel):
    name: str
    data: dict[str, Any]


class EventCreate(EventBase):
    user_id: UUID


class TurnBase(DBModel):
    start_time: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    end_time: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    completed: bool = False
