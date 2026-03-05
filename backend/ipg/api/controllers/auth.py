import secrets
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from loguru import logger
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ipg.api.constants import EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS, PASSWORD_RESET_TOKEN_EXPIRE_HOURS
from ipg.api.controllers.shared import get_password_hash, verify_password
from ipg.api.models.table import User
from ipg.api.models.token import EmailVerificationToken, PasswordResetToken
from ipg.api.models.user import UserCreate
from ipg.api.schemas.auth import LoginResult, LoginUserData, TokenPairResponse, TokenPayload
from ipg.api.schemas.error import (
    InvalidCredentialsError,
    InvalidOrExpiredTokenError,
    InvalidTokenError,
    TokenExpiredError,
    UserNotFoundError,
)
from ipg.api.services.email import EmailService
from ipg.settings import Settings


class AuthController:
    """Controller for authentication operations."""

    def __init__(self, session: AsyncSession, settings: Settings):
        self.session = session
        self.settings = settings

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a plain password against a hashed password.

        Uses passlib bcrypt context from shared module.

        :param plain_password: The plain text password to verify.
        :param hashed_password: The hashed password to verify against.
        :return: True if the password matches, False otherwise.
        """
        return verify_password(plain_password, hashed_password)

    @staticmethod
    def get_password_hash(password: str) -> str:
        """Hash a password using the shared password context.

        :param password: The plain text password to hash.
        :return: The hashed password string.
        """
        return get_password_hash(password)

    def create_access_token(self, user_id: str, email: str) -> str:
        """Create a JWT access token.

        :param user_id: The user's unique identifier.
        :param email: The user's email address.
        :return: Encoded JWT access token string.
        """
        expire = datetime.now(UTC) + timedelta(minutes=self.settings.access_token_expire_minutes)
        payload = {
            "sub": user_id,
            "email": email,
            "exp": expire,
        }
        return jwt.encode(payload, self.settings.jwt_secret_key, algorithm=self.settings.jwt_encryption_algorithm)

    def create_refresh_token(self, user_id: str, email: str) -> str:
        """Create a JWT refresh token with longer expiry.

        :param user_id: The user's unique identifier.
        :param email: The user's email address.
        :return: Encoded JWT refresh token string.
        """
        expire = datetime.now(UTC) + timedelta(days=self.settings.refresh_token_expire_days)
        payload = {
            "sub": user_id,
            "email": email,
            "exp": expire,
        }
        return jwt.encode(payload, self.settings.jwt_secret_key, algorithm=self.settings.jwt_encryption_algorithm)

    def create_token_pair(self, user_id: str, email: str) -> TokenPairResponse:
        """Create both access and refresh tokens.

        :param user_id: The user's unique identifier.
        :param email: The user's email address.
        :return: TokenPairResponse with both tokens.
        """
        return TokenPairResponse(
            access_token=self.create_access_token(user_id, email),
            refresh_token=self.create_refresh_token(user_id, email),
        )

    def decode_token(self, token: str) -> TokenPayload:
        """Decode and validate a JWT token.

        :param token: The JWT token string to decode.
        :return: TokenPayload with the decoded claims.
        :raises InvalidTokenError: If the token is malformed or invalid.
        :raises TokenExpiredError: If the token has expired.
        """
        try:
            payload = jwt.decode(
                token,
                self.settings.jwt_secret_key,
                algorithms=[self.settings.jwt_encryption_algorithm],
            )
            return TokenPayload(**payload)
        except JWTError as e:
            if "expired" in str(e).lower():
                raise TokenExpiredError() from e
            raise InvalidTokenError() from e

    async def login(self, email: str, password: str) -> LoginResult:
        """Authenticate a user and return tokens with user data.

        :param email: The user's email address.
        :param password: The user's plain text password.
        :return: LoginResult with tokens and user info.
        :raises InvalidCredentialsError: If the email or password is incorrect.
        """
        user = await self.get_user_by_email(email)
        if user is None:
            raise InvalidCredentialsError(email=email)

        if not self.verify_password(password, user.password):
            raise InvalidCredentialsError(email=email)

        tokens = self.create_token_pair(str(user.id), user.email_address)
        return LoginResult(
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            user=LoginUserData(
                id=str(user.id),
                username=user.username,
                email=user.email_address,
            ),
        )

    async def register(self, user_create: UserCreate) -> User:
        """Register a new user with a hashed password.

        :param user_create: The user creation data.
        :return: The newly created User.
        """
        hashed_password = self.get_password_hash(user_create.password)
        user_data = user_create.model_dump()
        user_data["password"] = hashed_password
        new_user = User(**user_data)
        self.session.add(new_user)
        await self.session.commit()
        await self.session.refresh(new_user)
        return new_user

    async def get_user_by_email(self, email: str) -> User | None:
        """Get a user by their email address.

        :param email: The email address to search for.
        :return: The User if found, None otherwise.
        """
        result = await self.session.exec(select(User).where(User.email_address == email))
        return result.first()

    async def request_password_reset(self, email: str, email_service: EmailService) -> bool:
        """Generate a password reset token and send email."""
        user = await self.get_user_by_email(email)
        if not user:
            # Don't reveal whether user exists — return silently
            logger.info("Password reset requested for non-existent email: {email}", email=email)
            return True

        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(UTC) + timedelta(hours=PASSWORD_RESET_TOKEN_EXPIRE_HOURS)
        reset_token = PasswordResetToken(user_id=user.id, token=token, expires_at=expires_at)
        self.session.add(reset_token)
        await self.session.commit()

        reset_url = f"{self.settings.frontend_url}/auth/reset-password?token={token}"
        await email_service.send_password_reset_email(user.email_address, user.username, reset_url)
        return True

    async def reset_password(self, token: str, new_password: str) -> bool:
        """Validate reset token and update password."""
        result = await self.session.exec(
            select(PasswordResetToken).where(PasswordResetToken.token == token).where(PasswordResetToken.used == False)  # noqa: E712
        )
        reset_token = result.first()
        if not reset_token or reset_token.expires_at < datetime.now(UTC):
            raise InvalidOrExpiredTokenError()

        user = (await self.session.exec(select(User).where(User.id == reset_token.user_id))).first()
        if not user:
            raise UserNotFoundError(user_id=reset_token.user_id)

        user.password = get_password_hash(new_password)
        reset_token.used = True
        self.session.add(user)
        self.session.add(reset_token)
        await self.session.commit()
        return True

    async def send_verification_email(self, user: User, email_service: EmailService) -> bool:
        """Generate verification token and send email."""
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(UTC) + timedelta(hours=EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS)
        verify_token = EmailVerificationToken(user_id=user.id, token=token, expires_at=expires_at)
        self.session.add(verify_token)
        await self.session.commit()

        verify_url = f"{self.settings.frontend_url}/auth/verify-email?token={token}"
        await email_service.send_verification_email(user.email_address, user.username, verify_url)
        return True

    async def verify_email(self, token: str) -> bool:
        """Validate verification token and mark email as verified."""
        result = await self.session.exec(
            select(EmailVerificationToken)
            .where(EmailVerificationToken.token == token)
            .where(EmailVerificationToken.used == False)  # noqa: E712
        )
        verify_token = result.first()
        if not verify_token or verify_token.expires_at < datetime.now(UTC):
            raise InvalidOrExpiredTokenError()

        user = (await self.session.exec(select(User).where(User.id == verify_token.user_id))).first()
        if not user:
            raise UserNotFoundError(user_id=verify_token.user_id)

        user.email_verified = True
        verify_token.used = True
        self.session.add(user)
        self.session.add(verify_token)
        await self.session.commit()
        return True

    async def resend_verification(self, email: str, email_service: EmailService) -> bool:
        """Resend verification email."""
        user = await self.get_user_by_email(email)
        if not user or user.email_verified:
            return True  # Don't reveal info
        return await self.send_verification_email(user, email_service)
