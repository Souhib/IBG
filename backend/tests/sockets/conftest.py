"""Test configuration for Socket.IO tests with real Redis via testcontainers.

Starts a redis-stack container (session-scoped) so that Redis OM models
(Room, User, UndercoverGame, CodenamesGame) operate against a real Redis
instance instead of mocks.  Only external services (sio, DB controllers)
are mocked in individual tests.
"""

import os

# Set env defaults BEFORE any socketio imports trigger Settings / connection creation.
os.environ.setdefault("REDIS_OM_URL", "redis://localhost:6379")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("LOGFIRE_TOKEN", "fake")

import pytest
import pytest_asyncio
from testcontainers.core.container import DockerContainer
from testcontainers.core.waiting_utils import wait_for_logs

from ibg.api.models.undercover import UndercoverRole
from ibg.socketio.models.codenames import (
    CodenamesCard,
    CodenamesCardType,
    CodenamesGame,
    CodenamesGameStatus,
    CodenamesPlayer,
    CodenamesRole,
    CodenamesTeam,
    CodenamesTurn,
)
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.socket import UndercoverGame, UndercoverTurn
from ibg.socketio.models.user import UndercoverSocketPlayer
from ibg.socketio.models.user import User as RedisUser

# ---------------------------------------------------------------------------
# Session-scoped Redis container
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def redis_container():
    """Start a redis-stack container for the entire test session."""
    container = DockerContainer("redis/redis-stack:latest")
    container.with_exposed_ports(6379)
    container.start()
    wait_for_logs(container, "Ready to accept connections", timeout=30)

    host = container.get_container_host_ip()
    port = container.get_exposed_port(6379)
    redis_url = f"redis://{host}:{port}"
    os.environ["REDIS_OM_URL"] = redis_url

    # Clear the singleton cache so it picks up the new URL
    from ibg.socketio.dependencies import _cache

    _cache.clear()

    # Get a fresh connection pointing to the test container
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()

    # Patch every module-level reference to `redis_connection`
    import ibg.socketio.controllers.room as room_ctrl_mod
    import ibg.socketio.controllers.undercover_game as uc_mod
    import ibg.socketio.models.shared as shared_mod
    import ibg.socketio.utils.redis_ttl as ttl_mod

    shared_mod.redis_connection = conn
    shared_mod.RedisJsonModel.Meta.database = conn
    uc_mod.redis_connection = conn
    ttl_mod.redis_connection = conn
    room_ctrl_mod.redis_connection = conn

    yield container
    container.stop()


# ---------------------------------------------------------------------------
# Per-test Redis cleanup (NOT autouse — pulled in by factory fixtures)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def redis_cleanup(redis_container):  # noqa: ARG001
    """Flush Redis after the test. Triggered by factory fixtures, not autouse."""
    yield
    from ibg.socketio.dependencies import get_redis_connection_singleton

    conn = get_redis_connection_singleton()
    await conn.flushall()


# ---------------------------------------------------------------------------
# Factory fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def make_redis_room(redis_cleanup):  # noqa: ARG001
    """Factory fixture to create and save a RedisRoom."""

    async def _make(
        room_id: str,
        users: list | None = None,
        owner_id: str | None = None,
        active_game_id: str | None = None,
        active_game_type: str | None = None,
    ) -> RedisRoom:
        room = RedisRoom(
            pk=room_id,
            id=room_id,
            users=users or [],
            owner_id=owner_id,
            active_game_id=active_game_id,
            active_game_type=active_game_type,
        )
        await room.save()
        return room

    return _make


@pytest_asyncio.fixture
async def make_redis_user(redis_cleanup):  # noqa: ARG001
    """Factory fixture to create and save a RedisUser."""

    async def _make(
        user_id: str,
        username: str,
        sid: str,
        room_id: str | None = None,
    ) -> RedisUser:
        user = RedisUser(
            pk=user_id,
            id=user_id,
            username=username,
            sid=sid,
            room_id=room_id,
        )
        await user.save()
        return user

    return _make


@pytest_asyncio.fixture
async def make_undercover_game(redis_cleanup):  # noqa: ARG001
    """Factory fixture to create and save an UndercoverGame in Redis."""

    async def _make(
        game_id: str,
        room_id: str,
        players: list[UndercoverSocketPlayer],
        civilian_word: str = "prayer",
        undercover_word: str = "fasting",
        turns: list[UndercoverTurn] | None = None,
        eliminated_players: list[UndercoverSocketPlayer] | None = None,
    ) -> UndercoverGame:
        game = UndercoverGame(
            pk=game_id,
            room_id=room_id,
            id=game_id,
            civilian_word=civilian_word,
            undercover_word=undercover_word,
            players=players,
            turns=turns or [],
            eliminated_players=eliminated_players or [],
        )
        await game.save()
        return game

    return _make


@pytest_asyncio.fixture
async def make_codenames_game(redis_cleanup):  # noqa: ARG001
    """Factory fixture to create and save a CodenamesGame in Redis."""

    async def _make(
        game_id: str,
        room_id: str,
        board: list[CodenamesCard],
        players: list[CodenamesPlayer],
        current_team: CodenamesTeam = CodenamesTeam.RED,
        current_turn: CodenamesTurn | None = None,
        status: CodenamesGameStatus = CodenamesGameStatus.IN_PROGRESS,
        red_remaining: int = 9,
        blue_remaining: int = 8,
        winner: CodenamesTeam | None = None,
    ) -> CodenamesGame:
        game = CodenamesGame(
            pk=game_id,
            room_id=room_id,
            id=game_id,
            board=board,
            players=players,
            current_team=current_team,
            current_turn=current_turn,
            red_remaining=red_remaining,
            blue_remaining=blue_remaining,
            status=status,
            winner=winner,
        )
        await game.save()
        return game

    return _make


# ---------------------------------------------------------------------------
# Shared helpers (importable by test files)
# ---------------------------------------------------------------------------


def make_undercover_player(
    user_id: str,
    role: UndercoverRole = UndercoverRole.CIVILIAN,
    alive: bool = True,
    is_mayor: bool = False,
) -> UndercoverSocketPlayer:
    """Create an UndercoverSocketPlayer with sensible defaults."""
    return UndercoverSocketPlayer(
        user_id=user_id,
        username=f"player_{user_id[:8]}",
        role=role,
        sid=f"sid-{user_id[:8]}",
        is_alive=alive,
        is_mayor=is_mayor,
    )


def make_codenames_player(
    user_id: str,
    team: CodenamesTeam = CodenamesTeam.RED,
    role: CodenamesRole = CodenamesRole.OPERATIVE,
) -> CodenamesPlayer:
    """Create a CodenamesPlayer with sensible defaults."""
    return CodenamesPlayer(
        sid=f"sid-{user_id[:8]}",
        user_id=user_id,
        username=f"player_{user_id[:8]}",
        team=team,
        role=role,
    )


def make_codenames_board(words: list[str] | None = None) -> list[CodenamesCard]:
    """Build a 25-card board with known card types.

    Layout: 9 RED | 8 BLUE | 7 NEUTRAL | 1 ASSASSIN.
    """
    if words is None:
        words = [f"word_{i}" for i in range(25)]
    card_types = (
        [CodenamesCardType.RED] * 9
        + [CodenamesCardType.BLUE] * 8
        + [CodenamesCardType.NEUTRAL] * 7
        + [CodenamesCardType.ASSASSIN] * 1
    )
    return [
        CodenamesCard(word=w, card_type=ct, revealed=False)
        for w, ct in zip(words, card_types, strict=True)
    ]
