from contextlib import asynccontextmanager

import uvicorn
from aredis_om import Migrator
from fastapi import FastAPI

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
    await Migrator().run()
    engine = await create_app_engine(settings)
    await create_db_and_tables(engine)
    yield
    from ibg.socketio.utils.disconnect_tasks import stop_polling

    stop_polling()
    await engine.dispose()


app = create_app(lifespan=lifespan)


if __name__ == "__main__":
    uvicorn.run(app, port=5000)
