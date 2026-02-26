import traceback
from datetime import UTC, datetime
from uuid import UUID

import socketio
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from scalar_fastapi import get_scalar_api_reference
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import NoResultFound
from starlette.responses import JSONResponse

from ibg.api.middleware import LoggingMiddleware, RequestIDMiddleware, SecurityMiddleware
from ibg.api.routes.auth import limiter
from ibg.api.routes.auth import router as auth_router
from ibg.api.routes.codenames import router as codenames_router
from ibg.api.routes.game import router as game_router
from ibg.api.routes.room import router as room_router
from ibg.api.routes.stats import router as stats_router
from ibg.api.routes.undercover import router as undercover_router
from ibg.api.routes.user import router as user_router
from ibg.api.schemas.error import BaseError
from ibg.settings import Settings
from ibg.socketio.models.shared import IBGSocket
from ibg.socketio.routes import codenames, room, undercover
from ibg.socketio.routes.room import router as socket_router


def _create_sio(settings: Settings) -> IBGSocket:
    """Create and configure the Socket.IO server with all event handlers."""
    sio = IBGSocket(
        cors_origins=settings.cors_origins,
        ping_interval=settings.sio_ping_interval,
        ping_timeout=settings.sio_ping_timeout,
    )
    room.room_events(sio)
    undercover.undercover_events(sio)
    codenames.codenames_events(sio)
    return sio


def create_app(lifespan) -> socketio.ASGIApp:
    """
    It creates a FastAPI app, adds CORS middleware, includes routers with /api/v1 prefix,
    adds security/logging middleware, and configures exception handlers.

    :return: A FastAPI object
    """
    settings = Settings()  # type: ignore
    app = FastAPI(title="IBG", lifespan=lifespan)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Middleware stack (order matters: first added = outermost)
    # Pure ASGI middleware — no BaseHTTPMiddleware overhead
    app.add_middleware(SecurityMiddleware, is_production=settings.environment == "production")
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(LoggingMiddleware)
    app.add_middleware(
        CORSMiddleware,  # type: ignore
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers with /api/v1 prefix
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(user_router, prefix="/api/v1")
    app.include_router(room_router, prefix="/api/v1")
    app.include_router(game_router, prefix="/api/v1")
    app.include_router(undercover_router, prefix="/api/v1")
    app.include_router(codenames_router, prefix="/api/v1")
    app.include_router(stats_router, prefix="/api/v1")
    app.include_router(socket_router)

    @app.get("/scalar", include_in_schema=False)
    async def scalar_html():
        return get_scalar_api_reference(
            openapi_url="/openapi.json",
            title="IBG API Scalar",
        )

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "timestamp": datetime.now(UTC).isoformat()}

    @app.exception_handler(NoResultFound)
    async def no_result_found_exception_handler(request: Request, exc: NoResultFound):
        return JSONResponse(
            status_code=404,
            content={
                "error_key": "errors.api.resourceNotFound",
                "frontend_message": "Couldn't find requested resource.",
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

    @app.exception_handler(BaseError)
    async def base_error_exception_handler(request: Request, exc: BaseError):
        details_status_codes = {400, 409, 422, 429}
        should_include_details = exc.status_code in details_status_codes

        serializable_details = {}
        if should_include_details and exc.details:
            serializable_details = {k: str(v) if isinstance(v, UUID) else v for k, v in exc.details.items()}

        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.error_code,
                "error_key": exc.error_key,
                "message": exc.frontend_message,
                "error_params": exc.error_params,
                "details": serializable_details if should_include_details else {},
                "timestamp": exc.timestamp.isoformat(),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_error_handler(request: Request, exc: RequestValidationError):
        logger.warning(
            "Request validation failed: {path}",
            path=request.url.path,
            method=request.method,
            errors=exc.errors(),
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "ValidationError",
                "error_key": "errors.api.validation",
                "message": "Invalid request data. Please check your input.",
                "error_params": None,
                "details": exc.errors(),
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        logger.error(
            "Unexpected server error: {error} - {message}",
            error=exc.__class__.__name__,
            message=str(exc),
            path=request.url.path,
            method=request.method,
            traceback=traceback.format_exc(),
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "InternalServerError",
                "error_key": "errors.api.internalServer",
                "message": "Something went wrong on our end. Please try again later.",
                "error_params": None,
                "details": {},
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

    sio = _create_sio(settings)
    return socketio.ASGIApp(sio, other_asgi_app=app)
