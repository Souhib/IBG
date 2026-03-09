from uuid import uuid4

import pytest
from sqlmodel.ext.asyncio.session import AsyncSession

from ipg.api.controllers.profile import ProfileController
from ipg.api.controllers.stats import StatsController
from ipg.api.schemas.error import UserNotFoundError


async def test_get_public_profile_with_no_stats(profile_controller: ProfileController, create_user):
    """A user with no stats record returns zeroed-out counters and no bio."""

    # Arrange
    user = await create_user(username="nostats", email="nostats@test.com")

    # Act
    profile = await profile_controller.get_public_profile(user.id)

    # Assert
    assert profile.user_id == user.id
    assert profile.username == "nostats"
    assert profile.bio is None
    assert profile.total_games_played == 0
    assert profile.total_games_won == 0
    assert profile.win_rate == 0.0
    assert profile.current_win_streak == 0


async def test_get_public_profile_with_stats(
    profile_controller: ProfileController, stats_controller: StatsController, create_user
):
    """A user with stats returns the correct played, won, and win_rate values."""

    # Arrange
    user = await create_user(username="withstats", email="withstats@test.com")
    await stats_controller.update_stats_after_game(user.id, "undercover", won=True, role="civilian")
    await stats_controller.update_stats_after_game(user.id, "undercover", won=False, role="civilian")

    # Act
    profile = await profile_controller.get_public_profile(user.id)

    # Assert
    assert profile.user_id == user.id
    assert profile.username == "withstats"
    assert profile.total_games_played == 2
    assert profile.total_games_won == 1
    assert profile.win_rate == 50.0
    assert profile.current_win_streak == 0


async def test_get_public_profile_with_bio(profile_controller: ProfileController, create_user):
    """A user whose bio has been set returns that bio in the public profile."""

    # Arrange
    user = await create_user(username="bioplayer", email="bioplayer@test.com")
    await profile_controller.update_bio(user.id, "Salam, I love Islamic trivia!")

    # Act
    profile = await profile_controller.get_public_profile(user.id)

    # Assert
    assert profile.bio == "Salam, I love Islamic trivia!"


async def test_get_public_profile_user_not_found(profile_controller: ProfileController):
    """Requesting a public profile for a non-existent user raises UserNotFoundError."""

    # Arrange
    random_id = uuid4()

    # Act / Assert
    with pytest.raises(UserNotFoundError):
        await profile_controller.get_public_profile(random_id)


async def test_get_public_profile_win_rate_calculation(
    profile_controller: ProfileController, stats_controller: StatsController, create_user
):
    """Win rate is correctly rounded: 2 wins out of 3 games yields 66.7."""

    # Arrange
    user = await create_user(username="winrate", email="winrate@test.com")
    await stats_controller.update_stats_after_game(user.id, "undercover", won=True, role="civilian")
    await stats_controller.update_stats_after_game(user.id, "undercover", won=True, role="civilian")
    await stats_controller.update_stats_after_game(user.id, "undercover", won=False, role="civilian")

    # Act
    profile = await profile_controller.get_public_profile(user.id)

    # Assert
    assert profile.total_games_played == 3
    assert profile.total_games_won == 2
    assert profile.win_rate == 66.7


async def test_update_bio_success(profile_controller: ProfileController, session: AsyncSession, create_user):
    """Updating a bio returns the user with the new bio and persists it in the database."""

    # Arrange
    user = await create_user(username="updatebio", email="updatebio@test.com")

    # Act
    updated_user = await profile_controller.update_bio(user.id, "New bio here")

    # Assert — return value
    assert updated_user.bio == "New bio here"

    # Assert — database state
    await session.refresh(user)
    assert user.bio == "New bio here"


async def test_update_bio_to_none(profile_controller: ProfileController, session: AsyncSession, create_user):
    """Setting bio to None clears the bio field."""

    # Arrange
    user = await create_user(username="clearbio", email="clearbio@test.com")
    await profile_controller.update_bio(user.id, "Temporary bio")

    # Act
    updated_user = await profile_controller.update_bio(user.id, None)

    # Assert — return value
    assert updated_user.bio is None

    # Assert — database state
    await session.refresh(user)
    assert user.bio is None


async def test_update_bio_user_not_found(profile_controller: ProfileController):
    """Updating the bio for a non-existent user raises UserNotFoundError."""

    # Arrange
    random_id = uuid4()

    # Act / Assert
    with pytest.raises(UserNotFoundError):
        await profile_controller.update_bio(random_id, "Should fail")
