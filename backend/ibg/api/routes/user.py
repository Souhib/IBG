from collections.abc import Sequence
from uuid import UUID

from fastapi import APIRouter, Depends

from ibg.api.controllers.user import UserController
from ibg.api.models.user import UserCreate, UserUpdate, UserUpdatePassword
from ibg.api.models.view import UserView
from ibg.dependencies import get_user_controller

router = APIRouter(
    prefix="/users",
    tags=["users"],
    responses={404: {"description": "Not found"}},
)


@router.post("", response_model=UserView, status_code=201)
async def create_user(
    *,
    user: UserCreate,
    user_controller: UserController = Depends(get_user_controller),
) -> UserView:
    return UserView.model_validate(await user_controller.create_user(user))


@router.get("", response_model=Sequence[UserView])
async def get_all_users(
    *,
    user_controller: UserController = Depends(get_user_controller),
) -> Sequence[UserView]:
    return [UserView.model_validate(user) for user in await user_controller.get_users()]


@router.get("/{user_id}", response_model=UserView)
async def get_user_by_id(
    *,
    user_id: UUID,
    user_controller: UserController = Depends(get_user_controller),
) -> UserView:
    return UserView.model_validate(await user_controller.get_user_by_id(user_id))


@router.patch("/{user_id}", response_model=UserView)
async def update_user(
    *,
    user_id: UUID,
    user: UserUpdate,
    user_controller: UserController = Depends(get_user_controller),
) -> UserView:
    return UserView.model_validate(await user_controller.update_user_by_id(user_id, user))


@router.patch("/{user_id}/password", response_model=UserView)
async def update_user_password(
    *,
    user_id: UUID,
    user_update_password: UserUpdatePassword,
    user_controller: UserController = Depends(get_user_controller),
) -> UserView:
    return UserView.model_validate(await user_controller.update_user_password(user_id, user_update_password.password))


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    *,
    user_id: UUID,
    user_controller: UserController = Depends(get_user_controller),
) -> None:
    await user_controller.delete_user(user_id)
