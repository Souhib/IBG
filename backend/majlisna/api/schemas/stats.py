from datetime import date
from uuid import UUID

from majlisna.api.schemas.shared import BaseModel


class DailyGameRecord(BaseModel):
    """A single day's win/loss record for charts."""

    date: date
    wins: int
    losses: int
    total: int


class GameDurationStats(BaseModel):
    """Duration analytics for a user's games."""

    average_seconds: float
    fastest_seconds: float | None
    longest_seconds: float | None
    undercover_avg_seconds: float | None
    codenames_avg_seconds: float | None
    total_games_with_duration: int


class LeaderboardEntry(BaseModel):
    """A leaderboard row with username included."""

    user_id: UUID
    username: str
    total_games_played: int
    total_games_won: int
    win_rate: float
    current_win_streak: int
    longest_win_streak: int


class HeadToHeadStats(BaseModel):
    """Head-to-head stats between two players."""

    user_id: UUID
    opponent_id: UUID
    user_wins: int
    opponent_wins: int
    draws: int
    total_games: int


class AchievementWithProgress(BaseModel):
    """Achievement definition combined with user progress."""

    code: str
    name: str
    description: str
    icon: str
    category: str
    tier: int
    threshold: int
    progress: int
    unlocked: bool
    rarity_percentage: float | None = None
