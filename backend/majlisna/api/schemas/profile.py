from uuid import UUID

from majlisna.api.schemas.shared import BaseModel


class UpdateBioRequest(BaseModel):
    bio: str | None = None


class PublicProfile(BaseModel):
    user_id: UUID
    username: str
    bio: str | None
    total_games_played: int
    favorite_game: str | None
    undercover_games_played: int
    codenames_games_played: int
    wordquiz_games_played: int
