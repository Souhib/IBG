"""Test configuration and fixtures for IBG backend."""

import pytest
import pytest_asyncio
from faker import Faker
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from ibg.api.controllers.achievement import AchievementController
from ibg.api.controllers.auth import AuthController
from ibg.api.controllers.codenames import CodenamesController
from ibg.api.controllers.game import GameController
from ibg.api.controllers.room import RoomController
from ibg.api.controllers.shared import get_password_hash
from ibg.api.controllers.stats import StatsController
from ibg.api.controllers.undercover import UndercoverController
from ibg.api.controllers.user import UserController
from ibg.api.models.codenames import CodenamesWordPack, CodenamesWordPackCreate
from ibg.api.models.game import GameCreate, GameType
from ibg.api.models.room import RoomCreate, RoomStatus
from ibg.api.models.table import Room, User
from ibg.api.models.undercover import Word, WordCreate
from ibg.settings import Settings

# ========== Core Infrastructure ==========


@pytest.fixture(name="faker", scope="function")
def get_faker() -> Faker:
    """Get a Faker instance configured for French locale."""
    return Faker("fr_FR")


@pytest.fixture(name="test_settings", scope="function")
def get_test_settings() -> Settings:
    """Get test settings with safe defaults."""
    return Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        redis_om_url="redis://localhost:6379",
        jwt_secret_key="test-secret-key-for-unit-tests",
        jwt_encryption_algorithm="HS256",
        access_token_expire_minutes=15,
        refresh_token_expire_days=7,
        environment="test",
        log_level="WARNING",
        logfire_token="fake",
        frontend_url="http://localhost:3000",
        cors_origins="*",
    )


@pytest_asyncio.fixture(name="engine", scope="function")
async def get_engine():
    """Create an in-memory SQLite async engine for testing.

    Uses StaticPool to ensure all connections share the same in-memory database.
    Enables foreign key enforcement via PRAGMA.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):  # noqa: ARG001
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(name="session", scope="function")
async def get_session(engine: AsyncEngine) -> AsyncSession:
    """Create an async database session for testing."""
    async with AsyncSession(engine, expire_on_commit=False) as session:
        yield session


@pytest_asyncio.fixture(autouse=True, scope="function")
async def clear_database(engine: AsyncEngine):
    """Clear the database after each test function to prevent cross-test pollution."""
    yield
    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA foreign_keys = OFF;"))
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.execute(text("PRAGMA foreign_keys = ON;"))
        await conn.run_sync(lambda sync_engine: SQLModel.metadata.create_all(sync_engine, checkfirst=True))


# ========== Controller Fixtures ==========


@pytest_asyncio.fixture(name="auth_controller")
async def get_auth_controller(session: AsyncSession, test_settings: Settings) -> AuthController:
    """Create an AuthController instance for testing."""
    return AuthController(session, test_settings)


@pytest_asyncio.fixture(name="user_controller")
async def get_user_controller(session: AsyncSession) -> UserController:
    """Create a UserController instance for testing."""
    return UserController(session)


@pytest_asyncio.fixture(name="room_controller")
async def get_room_controller(session: AsyncSession) -> RoomController:
    """Create a RoomController instance for testing."""
    return RoomController(session)


@pytest_asyncio.fixture(name="game_controller")
async def get_game_controller(session: AsyncSession) -> GameController:
    """Create a GameController instance for testing."""
    return GameController(session)


@pytest_asyncio.fixture(name="undercover_controller")
async def get_undercover_controller(session: AsyncSession) -> UndercoverController:
    """Create an UndercoverController instance for testing."""
    return UndercoverController(session)


@pytest_asyncio.fixture(name="codenames_controller")
async def get_codenames_controller(session: AsyncSession) -> CodenamesController:
    """Create a CodenamesController instance for testing."""
    return CodenamesController(session)


@pytest_asyncio.fixture(name="stats_controller")
async def get_stats_controller(session: AsyncSession) -> StatsController:
    """Create a StatsController instance for testing."""
    return StatsController(session)


@pytest_asyncio.fixture(name="achievement_controller")
async def get_achievement_controller(session: AsyncSession) -> AchievementController:
    """Create an AchievementController instance for testing."""
    return AchievementController(session)


# ========== Factory Fixtures ==========


@pytest_asyncio.fixture(name="create_user")
async def get_create_user(session: AsyncSession):
    """Factory fixture for creating users in tests."""

    async def _create_user(
        username: str = "testuser",
        email: str = "test@example.com",
        password: str = "password123",
        country: str | None = None,
    ) -> User:
        hashed = get_password_hash(password)
        user = User(username=username, email_address=email, password=hashed, country=country)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user

    return _create_user


@pytest_asyncio.fixture(name="create_room")
async def get_create_room(room_controller: RoomController):
    """Factory fixture for creating rooms via the controller."""

    async def _create_room(
        owner: User,
        password: str = "1234",
        status: RoomStatus = RoomStatus.ONLINE,
    ) -> Room:
        room_create = RoomCreate(status=status, password=password, owner_id=owner.id)
        return await room_controller.create_room(room_create)

    return _create_room


@pytest_asyncio.fixture(name="create_word")
async def get_create_word(undercover_controller: UndercoverController):
    """Factory fixture for creating undercover words via the controller."""

    async def _create_word(
        word: str = "test_word",
        category: str = "test_category",
        short_description: str = "Short desc",
        long_description: str = "Long desc",
    ) -> Word:
        return await undercover_controller.create_word(
            WordCreate(
                word=word,
                category=category,
                short_description=short_description,
                long_description=long_description,
            )
        )

    return _create_word


@pytest_asyncio.fixture(name="create_codenames_word_pack")
async def get_create_codenames_word_pack(codenames_controller: CodenamesController):
    """Factory fixture for creating codenames word packs via the controller."""

    async def _create_pack(
        name: str = "Test Pack",
        description: str | None = "A test word pack",
    ) -> CodenamesWordPack:
        return await codenames_controller.create_word_pack(CodenamesWordPackCreate(name=name, description=description))

    return _create_pack


# ========== Sample Object Fixtures ==========
# Pre-created objects used across many tests to avoid repetition.


@pytest_asyncio.fixture(name="sample_user")
async def get_sample_user(create_user) -> User:
    """Create a sample user available for tests that need a pre-existing user."""
    return await create_user(username="sampleuser", email="sample@test.com", password="samplepass123")


@pytest_asyncio.fixture(name="sample_owner")
async def get_sample_owner(create_user) -> User:
    """Create a sample room owner for tests that need a room with an owner."""
    return await create_user(username="owner", email="owner@test.com", password="ownerpass123")


@pytest_asyncio.fixture(name="sample_room")
async def get_sample_room(sample_owner: User, create_room) -> Room:
    """Create a sample room with a sample owner for tests that need a pre-existing room."""
    return await create_room(owner=sample_owner, password="1234")


@pytest_asyncio.fixture(name="sample_game")
async def get_sample_game(sample_room: Room, game_controller: GameController):
    """Create a sample game inside the sample room."""
    game_create = GameCreate(room_id=sample_room.id, type=GameType.UNDERCOVER, number_of_players=4)
    return await game_controller.create_game(game_create)


@pytest_asyncio.fixture(name="sample_word")
async def get_sample_word(create_word) -> Word:
    """Create a sample undercover word for tests that need a pre-existing word."""
    return await create_word(
        word="mosque",
        category="islamic",
        short_description="Place of worship",
        long_description="A place where Muslims gather for prayer",
    )
