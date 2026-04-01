from uuid import UUID

from sqlalchemy.exc import NoResultFound
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from majlisna.api.models.stats import UserStats
from majlisna.api.models.table import User
from majlisna.api.schemas.error import UserNotFoundError
from majlisna.api.schemas.profile import PublicProfile


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
        uc_played = stats.undercover_games_played if stats else 0
        cn_played = stats.codenames_games_played if stats else 0
        wq_played = max(0, played - uc_played - cn_played)

        # Determine favorite game type from per-game stats
        favorite_game: str | None = None
        if stats:
            game_counts = {
                "undercover": uc_played,
                "codenames": cn_played,
                "word_quiz": wq_played,
            }
            max_count = max(game_counts.values())
            if max_count > 0:
                favorite_game = max(game_counts, key=lambda k: game_counts[k])

        return PublicProfile(
            user_id=user.id,
            username=user.username,
            bio=user.bio,
            total_games_played=played,
            favorite_game=favorite_game,
            undercover_games_played=uc_played,
            codenames_games_played=cn_played,
            wordquiz_games_played=wq_played,
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
