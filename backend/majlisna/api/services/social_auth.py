"""Social authentication service for Google Sign-In.

Handles access token verification via Google's userinfo API.
"""

import httpx
from loguru import logger

from majlisna.api.schemas.error import InvalidCredentialsError
from majlisna.api.schemas.social_auth import SocialTokenPayload
from majlisna.settings import Settings


class SocialAuthService:
    """Service for verifying Google OAuth2 access tokens."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def verify_google_access_token(self, access_token: str) -> SocialTokenPayload:
        """Verify a Google OAuth2 access token by calling Google's userinfo endpoint.

        :param access_token: The Google OAuth2 access token from the client.
        :return: Verified user info from Google.
        :raises InvalidCredentialsError: If the token is invalid or expired.
        """
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                resp.raise_for_status()
                user_info = resp.json()

            if not user_info.get("email_verified", False):
                raise InvalidCredentialsError()

            return SocialTokenPayload(
                sub=user_info["sub"],
                email=user_info["email"],
                email_verified=user_info.get("email_verified", False),
                first_name=user_info.get("given_name"),
                last_name=user_info.get("family_name"),
                picture=user_info.get("picture"),
            )

        except InvalidCredentialsError:
            raise
        except Exception as e:
            logger.warning("Google access token verification failed", error=str(e))
            raise InvalidCredentialsError() from e
