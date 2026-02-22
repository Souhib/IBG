import re
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from fastapi import status
from loguru import logger


class LogLevel(str, Enum):
    """Enum for log levels."""

    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class BaseError(Exception):
    """Base error class for all custom errors.

    Provides automatic logging, i18n key generation, and structured error info.
    """

    @classmethod
    def _generate_error_key(cls) -> str:
        """Generate i18n key from class name (e.g., UserNotFoundError -> errors.api.userNotFound)."""
        name = cls.__name__
        if name.endswith("Error"):
            name = name[:-5]
        camel = re.sub(r"([A-Z])", r"_\1", name).strip("_")
        parts = camel.split("_")
        camel_case = parts[0].lower() + "".join(p.capitalize() for p in parts[1:])
        return f"errors.api.{camel_case}"

    def __init__(
        self,
        message: str,
        frontend_message: str | None = None,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        error_code: str | None = None,
        error_key: str | None = None,
        error_params: dict[str, str | int | float] | None = None,
        details: dict[str, Any] | None = None,
        log_level: LogLevel | None = None,
    ):
        self.message = message
        self.frontend_message = frontend_message or message
        self.status_code = status_code
        self.error_code = error_code or self.__class__.__name__
        self.error_key = error_key or self._generate_error_key()
        self.error_params = error_params
        self.details = details or {}
        self.timestamp = datetime.now(UTC)

        if log_level is None:
            if status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
                log_level = LogLevel.ERROR
            else:
                log_level = LogLevel.WARNING

        log_function = {
            LogLevel.DEBUG: logger.debug,
            LogLevel.INFO: logger.info,
            LogLevel.WARNING: logger.warning,
            LogLevel.ERROR: logger.error,
            LogLevel.CRITICAL: logger.critical,
        }[log_level]

        log_function(
            f"{self.error_code}: {self.message}",
            error_code=self.error_code,
            status_code=self.status_code,
            details=self.details,
        )

        super().__init__(self.message)


# Authentication & Authorization Errors


class InvalidCredentialsError(BaseError):
    """Invalid login credentials."""

    def __init__(self, email: str | None = None):
        super().__init__(
            message=f"Invalid credentials for {email}" if email else "Invalid credentials",
            frontend_message="Please check your email and password and try again.",
            status_code=status.HTTP_401_UNAUTHORIZED,
            details={"email": email} if email else {},
        )


class UnauthorizedError(BaseError):
    """User is not authenticated."""

    def __init__(self, message: str = "Authentication required"):
        super().__init__(
            message=message,
            frontend_message="Please log in to continue.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


class TokenExpiredError(BaseError):
    """JWT token has expired."""

    def __init__(self):
        super().__init__(
            message="Token has expired",
            frontend_message="Your session has expired. Please log in again.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


class InvalidTokenError(BaseError):
    """JWT token is invalid."""

    def __init__(self, message: str = "Invalid token"):
        super().__init__(
            message=message,
            frontend_message="Invalid authentication token.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


class ForbiddenError(BaseError):
    """User lacks permission for this action."""

    def __init__(self, message: str = "Forbidden"):
        super().__init__(
            message=message,
            frontend_message="You don't have permission to perform this action.",
            status_code=status.HTTP_403_FORBIDDEN,
        )


# User Errors


class UserNotFoundError(BaseError):
    """User not found in the database."""

    def __init__(self, user_id: UUID):
        super().__init__(
            message=f"User with id {user_id} not found",
            frontend_message="User not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"user_id": str(user_id)},
        )


class UserAlreadyExistsError(BaseError):
    """User with this email already exists."""

    def __init__(self, email_address: str):
        super().__init__(
            message=f"User with email address {email_address} already exists",
            frontend_message="An account with this email already exists.",
            status_code=status.HTTP_409_CONFLICT,
            details={"email_address": email_address},
        )


class UserNotInRoomError(BaseError):
    """User is not in the specified room."""

    def __init__(self, user_id: UUID, room_id: UUID):
        super().__init__(
            message=f"User with id {user_id} is not in room with id {room_id}",
            frontend_message="You are not in this room.",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"user_id": str(user_id), "room_id": str(room_id)},
        )


class UserAlreadyInRoomError(BaseError):
    """User is already in a room."""

    def __init__(self, user_id: UUID | str, room_id: UUID | str):
        super().__init__(
            message=f"User with id {user_id} is already in room with id {room_id}",
            frontend_message="You are already in a room.",
            status_code=status.HTTP_409_CONFLICT,
            details={"user_id": str(user_id), "room_id": str(room_id)},
        )


# Room Errors


class RoomNotFoundError(BaseError):
    """Room not found."""

    def __init__(self, room_id: UUID | str):
        super().__init__(
            message=f"Room with id {room_id} not found",
            frontend_message="Room not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"room_id": str(room_id)},
        )


class RoomAlreadyExistsError(BaseError):
    """Room already exists."""

    def __init__(self, room_id: UUID | str):
        super().__init__(
            message=f"Room with id {room_id} already exists",
            frontend_message="This room already exists.",
            status_code=status.HTTP_409_CONFLICT,
            details={"room_id": str(room_id)},
        )


class WrongRoomPasswordError(BaseError):
    """Incorrect room password."""

    def __init__(self, room_id: UUID):
        super().__init__(
            message=f"The password to join the room with id {room_id} is incorrect",
            frontend_message="Incorrect room password.",
            status_code=status.HTTP_403_FORBIDDEN,
            details={"room_id": str(room_id)},
        )


class ErrorRoomIsNotActive(BaseError):
    """Room is not active."""

    def __init__(self, room_id: UUID):
        super().__init__(
            message=f"Room with id {room_id} is not active",
            frontend_message="This room is no longer active.",
            status_code=status.HTTP_403_FORBIDDEN,
            details={"room_id": str(room_id)},
        )


# Game Errors


class GameNotFoundError(BaseError):
    """Game not found."""

    def __init__(self, game_id: UUID | str):
        super().__init__(
            message=f"Game with id {game_id} not found",
            frontend_message="Game not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"game_id": str(game_id)},
        )


class NoTurnInsideGameError(BaseError):
    """No turn found inside the game."""

    def __init__(self, game_id: UUID | str):
        super().__init__(
            message=f"No turn inside game with id {game_id}",
            frontend_message="No active turn in this game.",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"game_id": str(game_id)},
        )


# Undercover Game Errors


class WordAlreadyExistsError(BaseError):
    """Word already exists in the database."""

    def __init__(self, word: str):
        super().__init__(
            message=f"Word {word} already exists",
            frontend_message="This word already exists.",
            status_code=status.HTTP_409_CONFLICT,
            details={"word": word},
        )


class WordNotFoundErrorId(BaseError):
    """Word not found by ID."""

    def __init__(self, word_id: UUID):
        super().__init__(
            message=f"Word with id {word_id} not found",
            frontend_message="Word not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"word_id": str(word_id)},
        )


class WordNotFoundErrorName(BaseError):
    """Word not found by name."""

    def __init__(self, word: str):
        super().__init__(
            message=f"Word {word} not found",
            frontend_message="Word not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"word": word},
        )


class TermPairAlreadyExistsError(BaseError):
    """Term pair already exists."""

    def __init__(self, term1: str, term2: str):
        super().__init__(
            message=f"Term pair {term1} - {term2} already exists",
            frontend_message="This term pair already exists.",
            status_code=status.HTTP_409_CONFLICT,
            details={"term1": term1, "term2": term2},
        )


class TermPairNotFoundError(BaseError):
    """Term pair not found."""

    def __init__(self, term_pair_id: UUID):
        super().__init__(
            message=f"Term pair with id {term_pair_id} not found",
            frontend_message="Term pair not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"term_pair_id": str(term_pair_id)},
        )


# Voting Errors


class CantVoteBecauseYouDeadError(BaseError):
    """Dead players cannot vote."""

    def __init__(self, user_id: UUID | str):
        super().__init__(
            message=f"User with id {user_id} can't vote because they're dead",
            frontend_message="You can't vote because you've been eliminated.",
            status_code=status.HTTP_403_FORBIDDEN,
            details={"user_id": str(user_id)},
        )


class CantVoteForYourselfError(BaseError):
    """Players cannot vote for themselves."""

    def __init__(self, user_id: UUID | str):
        super().__init__(
            message=f"User with id {user_id} can't vote for themselves",
            frontend_message="You can't vote for yourself.",
            status_code=status.HTTP_403_FORBIDDEN,
            details={"user_id": str(user_id)},
        )


class CantVoteForDeadPersonError(BaseError):
    """Cannot vote for an eliminated player."""

    def __init__(self, user_id: UUID | str, dead_user_id: UUID | str):
        super().__init__(
            message=f"User with id {user_id} can't vote for dead user with id {dead_user_id}",
            frontend_message="You can't vote for an eliminated player.",
            status_code=status.HTTP_403_FORBIDDEN,
            details={"user_id": str(user_id), "dead_user_id": str(dead_user_id)},
        )


class PlayerRemovedFromGameError(BaseError):
    """Player was removed from a game due to inactivity (disconnect timeout)."""

    def __init__(self, user_id: str, game_id: str):
        super().__init__(
            message=f"Player {user_id} was removed from game {game_id} due to inactivity",
            frontend_message="You were removed from this game due to inactivity.",
            status_code=status.HTTP_403_FORBIDDEN,
            details={"user_id": user_id, "game_id": game_id},
        )


# Redis Errors


class RedisUnavailableError(BaseError):
    """Redis is unavailable or misconfigured (e.g., MISCONF RDB snapshot failure)."""

    def __init__(self, operation: str, original_error: str | None = None):
        super().__init__(
            message=f"Redis unavailable during {operation}: {original_error}",
            frontend_message="The server is experiencing a temporary issue. Please try again.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            details={"operation": operation, "original_error": original_error or ""},
        )
