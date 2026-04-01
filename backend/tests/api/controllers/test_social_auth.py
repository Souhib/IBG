"""Tests for Google social authentication."""

from unittest.mock import AsyncMock

import pytest
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from majlisna.api.constants import AUTH_PROVIDER_EMAIL, AUTH_PROVIDER_GOOGLE
from majlisna.api.controllers.auth import AuthController
from majlisna.api.controllers.shared import get_password_hash
from majlisna.api.models.table import User
from majlisna.api.schemas.error import InvalidCredentialsError
from majlisna.api.schemas.social_auth import SocialTokenPayload
from majlisna.api.services.social_auth import SocialAuthService
from majlisna.settings import Settings


@pytest.fixture
def social_auth_service(test_settings: Settings) -> SocialAuthService:
    """Create a SocialAuthService for testing."""
    return SocialAuthService(test_settings)


@pytest.fixture
def google_token_payload() -> SocialTokenPayload:
    """Sample Google token payload."""
    return SocialTokenPayload(
        sub="google_sub_123456",
        email="socialuser@gmail.com",
        email_verified=True,
        first_name="John",
        last_name="Doe",
        picture="https://lh3.googleusercontent.com/photo.jpg",
    )


# ========== Google Social Login ==========


@pytest.mark.asyncio
async def test_google_new_user_created(
    auth_controller: AuthController,
    social_auth_service: SocialAuthService,
    session: AsyncSession,
    google_token_payload: SocialTokenPayload,
):
    """New user is created when Google account is not linked."""
    # Prepare
    social_auth_service.verify_google_access_token = AsyncMock(return_value=google_token_payload)

    # Act
    result = await auth_controller.social_login(
        social_auth_service=social_auth_service,
        access_token="fake_google_access_token",
    )

    # Assert
    assert result.is_new_user is True
    assert result.access_token
    assert result.refresh_token
    assert result.token_type == "bearer"
    assert result.expires_in > 0
    assert result.user.username == "john_doe"
    assert result.user.email == "socialuser@gmail.com"

    # Verify user in DB
    stmt = select(User).where(User.email_address == "socialuser@gmail.com")
    db_result = await session.exec(stmt)
    user = db_result.one()

    assert user.google_sub == "google_sub_123456"
    assert user.auth_provider == AUTH_PROVIDER_GOOGLE
    assert user.email_verified is True
    assert user.profile_picture_url == "https://lh3.googleusercontent.com/photo.jpg"


@pytest.mark.asyncio
async def test_google_returning_user(
    auth_controller: AuthController,
    social_auth_service: SocialAuthService,
    session: AsyncSession,
    google_token_payload: SocialTokenPayload,
):
    """Returning Google user logs in without creating a new account."""
    # Prepare — create user with google_sub
    hashed = get_password_hash("sentinel")
    user = User(
        username="existing_google",
        email_address="socialuser@gmail.com",
        password=hashed,
        google_sub="google_sub_123456",
        auth_provider=AUTH_PROVIDER_GOOGLE,
        email_verified=True,
    )
    session.add(user)
    await session.commit()

    social_auth_service.verify_google_access_token = AsyncMock(return_value=google_token_payload)

    # Act
    result = await auth_controller.social_login(
        social_auth_service=social_auth_service,
        access_token="fake_google_access_token",
    )

    # Assert
    assert result.is_new_user is False
    assert result.access_token
    assert result.user.username == "existing_google"


@pytest.mark.asyncio
async def test_google_links_existing_email(
    auth_controller: AuthController,
    social_auth_service: SocialAuthService,
    session: AsyncSession,
    google_token_payload: SocialTokenPayload,
):
    """Existing email user gets Google sub linked."""
    # Prepare — create email user with same email as Google payload
    hashed = get_password_hash("mypassword")
    user = User(
        username="emailuser",
        email_address="socialuser@gmail.com",
        password=hashed,
        auth_provider=AUTH_PROVIDER_EMAIL,
        email_verified=True,
    )
    session.add(user)
    await session.commit()

    social_auth_service.verify_google_access_token = AsyncMock(return_value=google_token_payload)

    # Act
    result = await auth_controller.social_login(
        social_auth_service=social_auth_service,
        access_token="fake_google_access_token",
    )

    # Assert
    assert result.is_new_user is False

    # Verify google_sub was linked
    stmt = select(User).where(User.email_address == "socialuser@gmail.com")
    db_result = await session.exec(stmt)
    linked_user = db_result.one()
    assert linked_user.google_sub == "google_sub_123456"


@pytest.mark.asyncio
async def test_google_invalid_token(
    auth_controller: AuthController,
    social_auth_service: SocialAuthService,
):
    """Invalid Google token raises InvalidCredentialsError."""
    # Prepare
    social_auth_service.verify_google_access_token = AsyncMock(side_effect=InvalidCredentialsError())

    # Act & Assert
    with pytest.raises(InvalidCredentialsError):
        await auth_controller.social_login(
            social_auth_service=social_auth_service,
            access_token="invalid_token",
        )


@pytest.mark.asyncio
async def test_social_user_cannot_login_with_password(
    auth_controller: AuthController,
    social_auth_service: SocialAuthService,
    session: AsyncSession,  # noqa: ARG001
    google_token_payload: SocialTokenPayload,
):
    """A user created via social login cannot authenticate with password."""
    # Prepare — create user via social login
    social_auth_service.verify_google_access_token = AsyncMock(return_value=google_token_payload)
    await auth_controller.social_login(
        social_auth_service=social_auth_service,
        access_token="fake_token",
    )

    # Act & Assert — try password login
    with pytest.raises(InvalidCredentialsError):
        await auth_controller.login("socialuser@gmail.com", "anypassword")


@pytest.mark.asyncio
async def test_username_generated_from_google_name(
    auth_controller: AuthController,
    social_auth_service: SocialAuthService,
):
    """Username is generated from Google first/last name."""
    # Prepare
    payload = SocialTokenPayload(
        sub="google_name_test",
        email="nametest@gmail.com",
        email_verified=True,
        first_name="Ahmad",
        last_name="Khan",
    )
    social_auth_service.verify_google_access_token = AsyncMock(return_value=payload)

    # Act
    result = await auth_controller.social_login(
        social_auth_service=social_auth_service,
        access_token="fake_token",
    )

    # Assert
    assert result.user.username == "ahmad_khan"


@pytest.mark.asyncio
async def test_username_fallback_to_email_prefix(
    auth_controller: AuthController,
    social_auth_service: SocialAuthService,
):
    """Username falls back to email prefix when no name is provided."""
    # Prepare
    payload = SocialTokenPayload(
        sub="google_noname_test",
        email="noname.user@gmail.com",
        email_verified=True,
    )
    social_auth_service.verify_google_access_token = AsyncMock(return_value=payload)

    # Act
    result = await auth_controller.social_login(
        social_auth_service=social_auth_service,
        access_token="fake_token",
    )

    # Assert — dots are stripped by the regex, so "noname.user" becomes "nonameuser"
    assert result.user.username == "nonameuser"
