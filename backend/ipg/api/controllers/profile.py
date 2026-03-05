from uuid import UUID

from sqlalchemy.exc import NoResultFound
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ipg.api.models.stats import UserStats
from ipg.api.models.table import User
from ipg.api.schemas.error import UserNotFoundError
from ipg.api.schemas.shared import BaseModel


class PublicProfile(BaseModel):
    """Public profile visible to other users."""

    user_id: UUID
    username: str
    bio: str | None
    total_games_played: int
    total_games_won: int
    win_rate: float
    current_win_streak: int


class ProfileController:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_public_profile(self, user_id: UUID) -> PublicProfile:
        """Get a user's public profile with stats summary."""
        try:
            user = (await self.session.exec(select(User).where(User.id == user_id))).one()
        except NoResultFound:
            raise UserNotFoundError(user_id=user_id) from None

        stats = (await self.session.exec(select(UserStats).where(UserStats.user_id == user_id))).first()

        played = stats.total_games_played if stats else 0
        won = stats.total_games_won if stats else 0
        win_rate = round((won / played * 100), 1) if played > 0 else 0.0

        return PublicProfile(
            user_id=user.id,
            username=user.username,
            bio=user.bio,
            total_games_played=played,
            total_games_won=won,
            win_rate=win_rate,
            current_win_streak=stats.current_win_streak if stats else 0,
        )

    async def update_bio(self, user_id: UUID, bio: str | None) -> User:
        """Update a user's bio."""
        try:
            user = (await self.session.exec(select(User).where(User.id == user_id))).one()
        except NoResultFound:
            raise UserNotFoundError(user_id=user_id) from None

        user.bio = bio
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        return user
