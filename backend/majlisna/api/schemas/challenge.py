from uuid import UUID

from majlisna.api.schemas.shared import BaseModel


class ActiveChallenge(BaseModel):
    id: UUID
    code: str
    description: str
    challenge_type: str
    target_count: int
    game_type: str | None
    condition: str
    role: str | None
    progress: int
    completed: bool
    assigned_at: str
    expires_at: str
