from ipg.api.controllers.chat import ChatController


async def test_send_message(chat_controller: ChatController, create_user, create_room):
    """Sending a message stores it in the database with correct fields."""
    # Arrange
    user = await create_user(username="chatter", email="chatter@test.com")
    room = await create_room(owner=user)

    # Act
    msg = await chat_controller.send_message(
        room_id=room.id, user_id=user.id, username=user.username, message="Salam everyone"
    )

    # Assert
    assert msg.id is not None
    assert msg.room_id == room.id
    assert msg.user_id == user.id
    assert msg.username == "chatter"
    assert msg.message == "Salam everyone"
    assert msg.created_at is not None


async def test_get_messages(chat_controller: ChatController, create_user, create_room):
    """Retrieving messages for a room returns all messages in chronological order."""
    # Arrange
    user = await create_user(username="sender", email="sender@test.com")
    room = await create_room(owner=user)
    await chat_controller.send_message(room_id=room.id, user_id=user.id, username=user.username, message="First")
    await chat_controller.send_message(room_id=room.id, user_id=user.id, username=user.username, message="Second")
    await chat_controller.send_message(room_id=room.id, user_id=user.id, username=user.username, message="Third")

    # Act
    messages = await chat_controller.get_messages(room_id=room.id)

    # Assert
    assert len(messages) == 3
    assert messages[0].message == "First"
    assert messages[1].message == "Second"
    assert messages[2].message == "Third"


async def test_get_messages_incremental(chat_controller: ChatController, create_user, create_room):
    """Using after_id returns only messages created after the referenced message."""
    # Arrange
    user = await create_user(username="poller", email="poller@test.com")
    room = await create_room(owner=user)
    msg1 = await chat_controller.send_message(
        room_id=room.id, user_id=user.id, username=user.username, message="Old message"
    )
    await chat_controller.send_message(room_id=room.id, user_id=user.id, username=user.username, message="New message")
    await chat_controller.send_message(
        room_id=room.id, user_id=user.id, username=user.username, message="Newest message"
    )

    # Act
    messages = await chat_controller.get_messages(room_id=room.id, after_id=msg1.id)

    # Assert
    assert len(messages) == 2
    assert messages[0].message == "New message"
    assert messages[1].message == "Newest message"


async def test_message_truncated_at_500(chat_controller: ChatController, create_user, create_room):
    """Messages longer than 500 characters are truncated to exactly 500."""
    # Arrange
    user = await create_user(username="verbose", email="verbose@test.com")
    room = await create_room(owner=user)
    long_message = "a" * 600

    # Act
    msg = await chat_controller.send_message(
        room_id=room.id, user_id=user.id, username=user.username, message=long_message
    )

    # Assert
    assert len(msg.message) == 500
    assert msg.message == "a" * 500


async def test_get_messages_empty_room(chat_controller: ChatController, create_user, create_room):
    """Retrieving messages for a room with no messages returns an empty list."""
    # Arrange
    user = await create_user(username="emptyroom", email="empty@test.com")
    room = await create_room(owner=user)

    # Act
    messages = await chat_controller.get_messages(room_id=room.id)

    # Assert
    assert len(messages) == 0
