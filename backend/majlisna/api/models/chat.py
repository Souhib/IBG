from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field

from majlisna.api.schemas.shared import BaseTable


class ChatMessage(BaseTable, table=True):
    id: UUID | None = Field(default_factory=uuid4, primary_key=True, unique=True)
    room_id: UUID = Field(foreign_key="room.id", index=True)
    user_id: UUID = Field(foreign_key="user.id")
    username: str
    message: str = Field(max_length=500)
    created_at: datetime = Field(default_factory=datetime.now)
