import asyncio
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from ibg.api.controllers.disconnect import disconnect_checker_loop
from ibg.app import create_app
from ibg.database import create_app_engine, create_db_and_tables
from ibg.logger_config import configure_logger
from ibg.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager."""
    settings = Settings()  # type: ignore
    configure_logger(
        log_level=settings.log_level,
        serialize=settings.environment == "production",
    )
    engine = await create_app_engine(settings)
    await create_db_and_tables(engine)
    # Start disconnect checker background task
    task = asyncio.create_task(disconnect_checker_loop(engine))
    yield
    task.cancel()
    await engine.dispose()


app = create_app(lifespan=lifespan)


if __name__ == "__main__":
    uvicorn.run(app, port=5000)
