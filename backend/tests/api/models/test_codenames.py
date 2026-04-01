"""Tests for codenames model validation."""

from majlisna.api.models.codenames import CodenamesWordCreate, CodenamesWordPackCreate


def test_create_word_pack_with_name_and_description():
    """Creating a word pack with name and description succeeds."""

    # Arrange
    name = "Islamic Terms"
    description = "Common Islamic terminology"

    # Act
    pack = CodenamesWordPackCreate(name=name, description=description)

    # Assert
    assert pack.name == name
    assert pack.description == description


def test_create_word_pack_with_name_only():
    """Creating a word pack with only a name (no description) succeeds."""

    # Arrange / Act
    pack = CodenamesWordPackCreate(name="Prophets")

    # Assert
    assert pack.name == "Prophets"
    assert pack.description is None


def test_create_word():
    """Creating a codenames word with a word string succeeds."""

    # Arrange / Act
    word = CodenamesWordCreate(word="Quran")

    # Assert
    assert word.word == "Quran"


def test_create_word_with_hint():
    """Creating a codenames word with a hint dict succeeds."""

    # Arrange / Act
    word = CodenamesWordCreate(
        word="Quran",
        hint={"en": "The holy book of Islam", "ar": "الكتاب المقدس في الإسلام"},
    )

    # Assert
    assert word.hint is not None
    assert word.hint["en"] == "The holy book of Islam"
    assert word.hint["ar"] == "الكتاب المقدس في الإسلام"


def test_create_word_without_hint():
    """Creating a codenames word without a hint defaults to None."""

    # Arrange / Act
    word = CodenamesWordCreate(word="Quran")

    # Assert
    assert word.hint is None


def test_create_word_with_empty_hint():
    """Creating a codenames word with an empty hint dict succeeds."""

    # Arrange / Act
    word = CodenamesWordCreate(word="Quran", hint={})

    # Assert
    assert word.hint == {}
