"""Tests for WordQuiz CRUD controller."""

import pytest

from majlisna.api.controllers.wordquiz import WordQuizController


@pytest.mark.asyncio
async def test_create_quiz_word(create_quiz_word):
    """Creating a quiz word persists it to the database."""
    # Act
    word = await create_quiz_word(word_en="TestWord", category="TestCategory")

    # Assert
    assert word.id is not None
    assert word.word_en == "TestWord"
    assert word.category == "TestCategory"


@pytest.mark.asyncio
async def test_get_all_quiz_words(wordquiz_controller: WordQuizController, create_quiz_word):
    """get_all returns all quiz words."""
    # Prepare
    await create_quiz_word(word_en="Word1")
    await create_quiz_word(word_en="Word2")

    # Act
    words = await wordquiz_controller.get_all()

    # Assert
    assert len(words) == 2


@pytest.mark.asyncio
async def test_get_random_words(wordquiz_controller: WordQuizController, create_quiz_word):
    """get_random_words returns requested count of random words."""
    # Prepare
    await create_quiz_word(word_en="W1")
    await create_quiz_word(word_en="W2")
    await create_quiz_word(word_en="W3")

    # Act
    result = await wordquiz_controller.get_random_words(2)

    # Assert
    assert len(result) == 2


@pytest.mark.asyncio
async def test_get_random_words_with_exclusion(wordquiz_controller: WordQuizController, create_quiz_word):
    """get_random_words respects exclude_ids."""
    # Prepare
    w1 = await create_quiz_word(word_en="W1")
    await create_quiz_word(word_en="W2")

    # Act
    result = await wordquiz_controller.get_random_words(1, exclude_ids=[str(w1.id)])

    # Assert
    assert len(result) == 1
    assert result[0].word_en == "W2"


@pytest.mark.asyncio
async def test_delete_quiz_word(wordquiz_controller: WordQuizController, create_quiz_word):
    """delete removes the quiz word."""
    # Prepare
    word = await create_quiz_word(word_en="ToDelete")

    # Act
    await wordquiz_controller.delete(word.id)

    # Assert
    words = await wordquiz_controller.get_all()
    assert len(words) == 0
