from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from ipg.api.controllers.profile import ProfileController, PublicProfile
from ipg.api.models.table import User
from ipg.api.schemas.shared import BaseModel as PydanticBaseModel
from ipg.dependencies import get_current_user, get_profile_controller

router = APIRouter(
    prefix="/profiles",
    tags=["profiles"],
    responses={404: {"description": "Not found"}},
)


class UpdateBioRequest(PydanticBaseModel):
    bio: str | None = None


@router.get("/users/{user_id}", response_model=PublicProfile)
async def get_public_profile(
    *,
    user_id: UUID,
    profile_controller: Annotated[ProfileController, Depends(get_profile_controller)],
) -> PublicProfile:
    """Get a user's public profile."""
    return await profile_controller.get_public_profile(user_id)


@router.patch("/me", response_model=PublicProfile)
async def update_my_profile(
    *,
    body: UpdateBioRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    profile_controller: Annotated[ProfileController, Depends(get_profile_controller)],
) -> PublicProfile:
    """Update the current user's bio."""
    await profile_controller.update_bio(current_user.id, body.bio)
    return await profile_controller.get_public_profile(current_user.id)
