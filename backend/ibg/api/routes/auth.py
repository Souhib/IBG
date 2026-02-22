import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from ibg.api.controllers.auth import AuthController
from ibg.api.models.user import UserCreate
from ibg.api.models.view import UserView
from ibg.api.schemas.auth import LoginRequest, LoginResponse, LoginUserData, TokenPairResponse
from ibg.dependencies import get_auth_controller

limiter = Limiter(
    key_func=get_remote_address,
    enabled=os.getenv("RATE_LIMIT_ENABLED", "true").lower() != "false",
)

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)


@router.post("/register", response_model=UserView, status_code=201)
@limiter.limit("5/minute")
async def register(
    request: Request,
    *,
    user: UserCreate,
    auth_controller: Annotated[AuthController, Depends(get_auth_controller)],
) -> UserView:
    """Register a new user."""
    new_user = await auth_controller.register(user)
    return UserView.model_validate(new_user)


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute")
async def login(
    request: Request,
    *,
    login_request: LoginRequest,
    auth_controller: Annotated[AuthController, Depends(get_auth_controller)],
) -> LoginResponse:
    """Login and get JWT token pair with user data."""
    user = await auth_controller.get_user_by_email(login_request.email)
    if user is None:
        from ibg.api.schemas.error import InvalidCredentialsError

        raise InvalidCredentialsError(email=login_request.email)

    if not auth_controller.verify_password(login_request.password, user.password):
        from ibg.api.schemas.error import InvalidCredentialsError

        raise InvalidCredentialsError(email=login_request.email)

    tokens = auth_controller.create_token_pair(str(user.id), user.email_address)
    return LoginResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        user=LoginUserData(
            id=str(user.id),
            username=user.username,
            email=user.email_address,
        ),
    )


@router.post("/refresh", response_model=TokenPairResponse)
@limiter.limit("10/minute")
async def refresh_token(
    request: Request,
    *,
    refresh_token: str,
    auth_controller: Annotated[AuthController, Depends(get_auth_controller)],
) -> TokenPairResponse:
    """Refresh access token using refresh token."""
    payload = auth_controller.decode_token(refresh_token)
    return auth_controller.create_token_pair(payload.sub, payload.email)
