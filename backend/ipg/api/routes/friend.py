from collections.abc import Sequence
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from ipg.api.controllers.friend import FriendController
from ipg.api.models.table import User
from ipg.api.schemas.friend import FriendActionResponse, FriendEntry, FriendRequestBody, FriendshipStatusResponse
from ipg.dependencies import get_current_user, get_friend_controller

router = APIRouter(
    prefix="/friends",
    tags=["friends"],
    responses={404: {"description": "Not found"}},
)


@router.get("", response_model=Sequence[FriendEntry])
async def get_friends(
    *,
    current_user: Annotated[User, Depends(get_current_user)],
    friend_controller: Annotated[FriendController, Depends(get_friend_controller)],
) -> Sequence[FriendEntry]:
    """Get all accepted friends."""
    return await friend_controller.get_friends(current_user.id)


@router.get("/pending", response_model=Sequence[FriendEntry])
async def get_pending_requests(
    *,
    current_user: Annotated[User, Depends(get_current_user)],
    friend_controller: Annotated[FriendController, Depends(get_friend_controller)],
) -> Sequence[FriendEntry]:
    """Get pending friend requests sent to the current user."""
    return await friend_controller.get_pending_requests(current_user.id)


@router.get("/status/{user_id}", response_model=FriendshipStatusResponse)
async def get_friendship_status(
    *,
    user_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    friend_controller: Annotated[FriendController, Depends(get_friend_controller)],
) -> FriendshipStatusResponse:
    """Check friendship status with a specific user."""
    return await friend_controller.get_friendship_status(current_user.id, user_id)


@router.post("/request", status_code=201)
async def send_friend_request(
    *,
    body: FriendRequestBody,
    current_user: Annotated[User, Depends(get_current_user)],
    friend_controller: Annotated[FriendController, Depends(get_friend_controller)],
) -> FriendActionResponse:
    """Send a friend request."""
    friendship = await friend_controller.send_request(current_user.id, body.addressee_id)
    return FriendActionResponse(friendship_id=str(friendship.id), status=friendship.status.value)


@router.post("/{friendship_id}/accept")
async def accept_friend_request(
    *,
    friendship_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    friend_controller: Annotated[FriendController, Depends(get_friend_controller)],
) -> FriendActionResponse:
    """Accept a pending friend request."""
    friendship = await friend_controller.accept_request(friendship_id, current_user.id)
    return FriendActionResponse(friendship_id=str(friendship.id), status=friendship.status.value)


@router.post("/{friendship_id}/reject", status_code=204)
async def reject_friend_request(
    *,
    friendship_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    friend_controller: Annotated[FriendController, Depends(get_friend_controller)],
) -> None:
    """Reject a pending friend request."""
    await friend_controller.reject_request(friendship_id, current_user.id)


@router.delete("/{friendship_id}", status_code=204)
async def remove_friend(
    *,
    friendship_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    friend_controller: Annotated[FriendController, Depends(get_friend_controller)],
) -> None:
    """Remove an existing friendship."""
    await friend_controller.remove_friend(friendship_id, current_user.id)
