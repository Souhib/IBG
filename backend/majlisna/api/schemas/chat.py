from uuid import UUID

from majlisna.api.schemas.shared import BaseModel


class SendMessageRequest(BaseModel):
    message: str


class ChatMessageView(BaseModel):
    id: UUID
    room_id: UUID
    user_id: UUID
    username: str
    message: str
    created_at: str
