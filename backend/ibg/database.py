from urllib.parse import urlparse

from aredis_om import get_redis_connection
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool
from sqlmodel import SQLModel

from ibg.settings import Settings

_engine: AsyncEngine | None = None


async def create_app_engine(settings: Settings) -> AsyncEngine:
    """Create an async database engine with connection pooling.

    Args:
        settings: The application settings.

    Returns:
        AsyncEngine: The created database engine.
    """
    engine = create_async_engine(
        settings.database_url,
        poolclass=AsyncAdaptedQueuePool,
        pool_size=20,
        max_overflow=30,
        pool_timeout=30,
        pool_recycle=3600,
        pool_pre_ping=True,
        echo=False,
    )
    return engine


async def get_engine() -> AsyncEngine:
    """Get or create the database engine singleton.

    Returns:
        AsyncEngine: The database engine instance.
    """
    global _engine  # noqa: PLW0603
    if _engine is None:
        settings = Settings()  # type: ignore
        _engine = await create_app_engine(settings)
    return _engine


async def create_db_and_tables(engine: AsyncEngine, drop_all: bool = False) -> None:
    """Create all database tables.

    Args:
        engine: The database engine.
        drop_all: Whether to drop all tables before creating them.
    """
    async with engine.begin() as conn:
        if drop_all:
            await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)
        if "sqlite" in str(engine.url):
            await conn.execute(text("PRAGMA foreign_keys=ON"))


def get_redis_om_connection():
    """Get Redis OM connection using pydantic Settings.

    Returns:
        Redis connection configured for Redis OM.
    """
    from ibg.settings import Settings

    settings = Settings()  # type: ignore
    parsed = urlparse(settings.redis_om_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    password = parsed.password or None
    return get_redis_connection(host=host, port=port, password=password, decode_responses=True, encoding="utf-8")
