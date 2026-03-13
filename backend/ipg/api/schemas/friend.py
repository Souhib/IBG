from enum import StrEnum
from uuid import UUID

from ipg.api.schemas.shared import BaseModel


class FriendshipStatusEnum(StrEnum):
    NONE = "none"
    PENDING_SENT = "pending_sent"
    PENDING_RECEIVED = "pending_received"
    ACCEPTED = "accepted"
    BLOCKED = "blocked"


class FriendRequestBody(BaseModel):
    addressee_id: UUID


class FriendEntry(BaseModel):
    friendship_id: UUID
    user_id: UUID
    username: str
    status: str


class FriendActionResponse(BaseModel):
    friendship_id: str
    status: str


class FriendshipStatusResponse(BaseModel):
    status: FriendshipStatusEnum
    friendship_id: str | None = None
