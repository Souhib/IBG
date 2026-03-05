import pytest
from sqlmodel import select

from ipg.api.controllers.friend import FriendController
from ipg.api.models.friendship import Friendship, FriendshipStatus
from ipg.api.schemas.error import BaseError


async def test_send_friend_request(friend_controller: FriendController, create_user):
    """Sending a friend request creates a pending friendship between two users."""
    # Arrange
    requester = await create_user(username="requester", email="req@test.com")
    addressee = await create_user(username="addressee", email="addr@test.com")

    # Act
    friendship = await friend_controller.send_request(requester.id, addressee.id)

    # Assert — return value
    assert friendship.id is not None
    assert friendship.requester_id == requester.id
    assert friendship.addressee_id == addressee.id
    assert friendship.status == FriendshipStatus.PENDING

    # Assert — database state
    db_friendship = (
        await friend_controller.session.exec(select(Friendship).where(Friendship.id == friendship.id))
    ).first()
    assert db_friendship is not None
    assert db_friendship.status == FriendshipStatus.PENDING
    assert db_friendship.requester_id == requester.id
    assert db_friendship.addressee_id == addressee.id


async def test_accept_friend_request(friend_controller: FriendController, create_user):
    """Accepting a pending friend request changes its status to accepted."""
    # Arrange
    requester = await create_user(username="requester", email="req@test.com")
    addressee = await create_user(username="addressee", email="addr@test.com")
    friendship = await friend_controller.send_request(requester.id, addressee.id)

    # Act
    accepted = await friend_controller.accept_request(friendship.id, addressee.id)

    # Assert — return value
    assert accepted.id == friendship.id
    assert accepted.status == FriendshipStatus.ACCEPTED

    # Assert — database state
    db_friendship = (
        await friend_controller.session.exec(select(Friendship).where(Friendship.id == friendship.id))
    ).first()
    assert db_friendship is not None
    assert db_friendship.status == FriendshipStatus.ACCEPTED


async def test_reject_friend_request(friend_controller: FriendController, create_user):
    """Rejecting a pending friend request deletes it from the database."""
    # Arrange
    requester = await create_user(username="requester", email="req@test.com")
    addressee = await create_user(username="addressee", email="addr@test.com")
    friendship = await friend_controller.send_request(requester.id, addressee.id)
    friendship_id = friendship.id

    # Act
    await friend_controller.reject_request(friendship_id, addressee.id)

    # Assert — database state (friendship should be deleted)
    db_friendship = (
        await friend_controller.session.exec(select(Friendship).where(Friendship.id == friendship_id))
    ).first()
    assert db_friendship is None


async def test_get_friends(friend_controller: FriendController, create_user):
    """Getting friends returns only accepted friendships, not pending ones."""
    # Arrange
    user = await create_user(username="mainuser", email="main@test.com")
    friend1 = await create_user(username="friend1", email="f1@test.com")
    friend2 = await create_user(username="friend2", email="f2@test.com")
    pending_user = await create_user(username="pending", email="pending@test.com")

    # Create two accepted friendships
    f1 = await friend_controller.send_request(user.id, friend1.id)
    await friend_controller.accept_request(f1.id, friend1.id)

    f2 = await friend_controller.send_request(friend2.id, user.id)
    await friend_controller.accept_request(f2.id, user.id)

    # Create one pending friendship (should NOT appear)
    await friend_controller.send_request(user.id, pending_user.id)

    # Act
    friends = await friend_controller.get_friends(user.id)

    # Assert — return value
    assert len(friends) == 2
    friend_user_ids = {entry.user_id for entry in friends}
    assert friend1.id in friend_user_ids
    assert friend2.id in friend_user_ids
    assert all(entry.status == FriendshipStatus.ACCEPTED for entry in friends)


async def test_get_pending_requests(friend_controller: FriendController, create_user):
    """Getting pending requests returns only pending requests sent TO the user."""
    # Arrange
    user = await create_user(username="mainuser", email="main@test.com")
    sender1 = await create_user(username="sender1", email="s1@test.com")
    sender2 = await create_user(username="sender2", email="s2@test.com")
    accepted_friend = await create_user(username="accepted", email="acc@test.com")

    # Create two pending requests TO the user
    await friend_controller.send_request(sender1.id, user.id)
    await friend_controller.send_request(sender2.id, user.id)

    # Create one accepted friendship (should NOT appear)
    f = await friend_controller.send_request(accepted_friend.id, user.id)
    await friend_controller.accept_request(f.id, user.id)

    # Create one pending request FROM the user (should NOT appear)
    outgoing_target = await create_user(username="outgoing", email="out@test.com")
    await friend_controller.send_request(user.id, outgoing_target.id)

    # Act
    pending = await friend_controller.get_pending_requests(user.id)

    # Assert — return value
    assert len(pending) == 2
    sender_ids = {entry.user_id for entry in pending}
    assert sender1.id in sender_ids
    assert sender2.id in sender_ids
    assert all(entry.status == FriendshipStatus.PENDING for entry in pending)


async def test_remove_friend(friend_controller: FriendController, create_user):
    """Removing an accepted friendship deletes it from the database."""
    # Arrange
    user = await create_user(username="mainuser", email="main@test.com")
    friend = await create_user(username="friend", email="friend@test.com")
    friendship = await friend_controller.send_request(user.id, friend.id)
    await friend_controller.accept_request(friendship.id, friend.id)

    # Act
    await friend_controller.remove_friend(friendship.id, user.id)

    # Assert — database state (friendship should be deleted)
    db_friendship = (
        await friend_controller.session.exec(select(Friendship).where(Friendship.id == friendship.id))
    ).first()
    assert db_friendship is None

    # Assert — user's friends list is now empty
    friends = await friend_controller.get_friends(user.id)
    assert len(friends) == 0


async def test_cannot_send_duplicate_request(friend_controller: FriendController, create_user):
    """Sending a duplicate friend request raises a BaseError."""
    # Arrange
    requester = await create_user(username="requester", email="req@test.com")
    addressee = await create_user(username="addressee", email="addr@test.com")
    await friend_controller.send_request(requester.id, addressee.id)

    # Act & Assert
    with pytest.raises(BaseError, match="Request already sent"):
        await friend_controller.send_request(requester.id, addressee.id)

    # Assert — database state (only one friendship exists)
    results = (
        await friend_controller.session.exec(
            select(Friendship).where(
                Friendship.requester_id == requester.id,
                Friendship.addressee_id == addressee.id,
            )
        )
    ).all()
    assert len(results) == 1


async def test_cannot_friend_self(friend_controller: FriendController, create_user):
    """Sending a friend request to yourself raises a BaseError."""
    # Arrange
    user = await create_user(username="lonelyuser", email="lonely@test.com")

    # Act & Assert
    with pytest.raises(BaseError, match="Cannot friend yourself"):
        await friend_controller.send_request(user.id, user.id)

    # Assert — database state (no friendship created)
    results = (await friend_controller.session.exec(select(Friendship).where(Friendship.requester_id == user.id))).all()
    assert len(results) == 0
