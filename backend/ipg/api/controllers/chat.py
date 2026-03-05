from collections.abc import Sequence
from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ipg.api.models.chat import ChatMessage
from ipg.api.schemas.shared import BaseModel


class ChatMessageView(BaseModel):
    """Chat message for API response."""

    id: UUID
    room_id: UUID
    user_id: UUID
    username: str
    message: str
    created_at: str


class ChatController:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def send_message(self, room_id: UUID, user_id: UUID, username: str, message: str) -> ChatMessage:
        """Send a chat message to a room."""
        msg = ChatMessage(room_id=room_id, user_id=user_id, username=username, message=message[:500])
        self.session.add(msg)
        await self.session.commit()
        await self.session.refresh(msg)
        return msg

    async def get_messages(self, room_id: UUID, after_id: UUID | None = None, limit: int = 50) -> Sequence[ChatMessage]:
        """Get messages for a room, optionally after a specific message ID for incremental polling."""
        query = select(ChatMessage).where(ChatMessage.room_id == room_id)

        if after_id:
            # Get the timestamp of the after_id message
            ref_msg = (await self.session.exec(select(ChatMessage).where(ChatMessage.id == after_id))).first()
            if ref_msg:
                query = query.where(ChatMessage.created_at > ref_msg.created_at)

        query = query.order_by(ChatMessage.created_at.asc()).limit(limit)  # type: ignore[union-attr]
        return (await self.session.exec(query)).all()
