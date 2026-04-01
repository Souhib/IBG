"""Invariant verification tests for game state consistency."""

from uuid import UUID

import pytest
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from majlisna.api.controllers.codenames_game import CodenamesGameController
from majlisna.api.controllers.codenames_helpers import CodenamesRole
from majlisna.api.controllers.mcqquiz_game import McqQuizGameController
from majlisna.api.controllers.undercover_game import UndercoverGameController
from majlisna.api.controllers.wordquiz_game import WordQuizGameController
from majlisna.api.models.game import GameStatus
from majlisna.api.models.table import Game, Room
from majlisna.api.models.undercover import UndercoverRole
from majlisna.api.schemas.error import AlreadyAnsweredError, RoundNotPlayingError

# ─── Helpers ──────────────────────────────────────────────────


async def _start_game(controller, room_id, user_id):
    return await controller.create_and_start(room_id, user_id)


async def _get_game(session, game_id_str):
    return (await session.exec(select(Game).where(Game.id == UUID(game_id_str)))).first()


def _alive_players(state):
    return [p for p in state["players"] if p["is_alive"]]


async def _advance_to_voting(controller, session, game_id_str):
    game = await _get_game(session, game_id_str)
    order = game.live_state["turns"][0]["description_order"]
    game_uuid = UUID(game_id_str)
    for uid in order:
        await controller.submit_description(game_uuid, UUID(uid), "word")
    return await _get_game(session, game_id_str)


# ========== Tests ==========


@pytest.mark.asyncio
async def test_vote_count_matches_alive_voters(
    undercover_game_controller: UndercoverGameController,
    setup_undercover_game,
    session: AsyncSession,
):
    """Start 5-player undercover game, advance to voting. All 5 alive players vote.
    Verify: len(votes) == 5 (all alive players voted)."""
    # Prepare
    setup = await setup_undercover_game(5)
    room, users = setup["room"], setup["users"]
    result = await _start_game(undercover_game_controller, room.id, users[0].id)
    game = await _advance_to_voting(undercover_game_controller, session, result.game_id)
    state = game.live_state
    alive = _alive_players(state)
    game_uuid = UUID(result.game_id)

    # Act — all 5 alive players vote (each votes for next player in alive list)
    for i, player in enumerate(alive):
        target = alive[(i + 1) % len(alive)]
        await undercover_game_controller.submit_vote(game_uuid, UUID(player["user_id"]), UUID(target["user_id"]))

    # Assert
    game = await _get_game(session, result.game_id)
    votes = game.live_state["turns"][0]["votes"]
    assert len(votes) == 5
    assert len(votes) == len(alive)


@pytest.mark.asyncio
async def test_eliminated_players_never_in_alive_list(
    undercover_game_controller: UndercoverGameController,
    setup_undercover_game,
    session: AsyncSession,
):
    """Start 5-player game, advance to voting, all vote for same target.
    After elimination, verify: eliminated player has is_alive=False,
    and _alive_players() doesn't include them.
    Also verify they appear in eliminated_players list."""
    # Prepare
    setup = await setup_undercover_game(5)
    room, users = setup["room"], setup["users"]
    result = await _start_game(undercover_game_controller, room.id, users[0].id)
    game = await _advance_to_voting(undercover_game_controller, session, result.game_id)
    game_uuid = UUID(result.game_id)

    # Pick a target — everyone votes for users[2] (except users[2] who votes for users[0])
    target = users[2]
    for voter in users:
        vote_target = users[0] if voter.id == target.id else target
        await undercover_game_controller.submit_vote(game_uuid, voter.id, vote_target.id)

    # Assert
    game = await _get_game(session, result.game_id)
    state = game.live_state
    eliminated = next(p for p in state["players"] if p["user_id"] == str(target.id))
    assert eliminated["is_alive"] is False

    alive = _alive_players(state)
    alive_ids = [p["user_id"] for p in alive]
    assert str(target.id) not in alive_ids

    assert any(e["user_id"] == str(target.id) for e in state["eliminated_players"])


@pytest.mark.asyncio
async def test_live_state_survives_session_commit_refresh(
    undercover_game_controller: UndercoverGameController,
    setup_undercover_game,
    session: AsyncSession,
):
    """Start undercover game. Modify live_state (add a test field), flag_modified,
    commit, re-fetch from DB. Verify the change persisted."""
    # Prepare
    setup = await setup_undercover_game(3)
    room, users = setup["room"], setup["users"]
    result = await _start_game(undercover_game_controller, room.id, users[0].id)

    # Act — modify live_state with a custom field
    game = await _get_game(session, result.game_id)
    state = game.live_state
    state["_test_field"] = "persistence_check"
    game.live_state = state
    flag_modified(game, "live_state")
    session.add(game)
    await session.commit()

    # Assert — re-fetch and verify
    game_refetched = await _get_game(session, result.game_id)
    assert game_refetched.live_state["_test_field"] == "persistence_check"


@pytest.mark.asyncio
@pytest.mark.parametrize("num_players", [3, 5, 7, 10])
async def test_undercover_roles_sum_to_player_count(
    undercover_game_controller: UndercoverGameController,
    setup_undercover_game,
    session: AsyncSession,
    num_players: int,
):
    """Start games with 3, 5, 7, and 10 players. For each, verify:
    civilians + undercovers + mr_whites == total_players."""
    # Prepare
    setup = await setup_undercover_game(num_players)
    room, users = setup["room"], setup["users"]

    # Act
    result = await _start_game(undercover_game_controller, room.id, users[0].id)

    # Assert
    game = await _get_game(session, result.game_id)
    players = game.live_state["players"]
    roles = [p["role"] for p in players]
    civilians = roles.count(UndercoverRole.CIVILIAN.value)
    undercovers = roles.count(UndercoverRole.UNDERCOVER.value)
    mr_whites = roles.count(UndercoverRole.MR_WHITE.value)
    assert civilians + undercovers + mr_whites == num_players
    assert civilians >= 1  # must always have at least 1 civilian


@pytest.mark.asyncio
async def test_codenames_board_cards_sum_to_25(
    codenames_game_controller: CodenamesGameController,
    setup_codenames_game,
    session: AsyncSession,
):
    """Start codenames game. Verify: len(board) == 25. Verify total card count is 25."""
    # Prepare
    setup = await setup_codenames_game(4)
    room, users = setup["room"], setup["users"]

    # Act
    result = await _start_game(codenames_game_controller, room.id, users[0].id)

    # Assert
    game = await _get_game(session, result.game_id)
    board = game.live_state["board"]
    assert len(board) == 25

    # Verify all cards have a card_type
    card_types = [card["card_type"] for card in board]
    assert len(card_types) == 25
    assert all(ct is not None for ct in card_types)


@pytest.mark.asyncio
async def test_codenames_team_composition_valid(
    codenames_game_controller: CodenamesGameController,
    setup_codenames_game,
    session: AsyncSession,
):
    """Start 4-player codenames. Verify: each team has at least 1 player,
    each team has exactly 1 spymaster."""
    # Prepare
    setup = await setup_codenames_game(4)
    room, users = setup["room"], setup["users"]

    # Act
    result = await _start_game(codenames_game_controller, room.id, users[0].id)

    # Assert
    game = await _get_game(session, result.game_id)
    players = game.live_state["players"]

    red_players = [p for p in players if p["team"] == "red"]
    blue_players = [p for p in players if p["team"] == "blue"]

    assert len(red_players) >= 1
    assert len(blue_players) >= 1

    red_spymasters = [p for p in red_players if p["role"] == CodenamesRole.SPYMASTER.value]
    blue_spymasters = [p for p in blue_players if p["role"] == CodenamesRole.SPYMASTER.value]

    assert len(red_spymasters) == 1
    assert len(blue_spymasters) == 1


@pytest.mark.asyncio
async def test_wordquiz_scores_non_negative(
    wordquiz_game_controller: WordQuizGameController,
    setup_wordquiz_game,
    session: AsyncSession,
):
    """Start 2-player word quiz. Submit a wrong answer for one player.
    Verify: score is 0 (not negative). Submit correct answer for other.
    Verify: score > 0."""
    # Prepare
    setup = await setup_wordquiz_game(num_players=2)
    room, users = setup["room"], setup["users"]
    result = await _start_game(wordquiz_game_controller, room.id, users[0].id)

    # Act — submit wrong answer for player 0
    wrong_result = await wordquiz_game_controller.submit_answer(UUID(result.game_id), users[0].id, "TotallyWrongAnswer")

    # Assert — wrong answer gives 0 points
    assert wrong_result.correct is False
    assert wrong_result.points_earned == 0

    # Verify score in state is not negative
    game = await _get_game(session, result.game_id)
    player0 = next(p for p in game.live_state["players"] if p["user_id"] == str(users[0].id))
    assert player0["total_score"] >= 0

    # Act — submit correct answer for player 1
    correct_word = game.live_state["current_word"]["word_en"]
    correct_result = await wordquiz_game_controller.submit_answer(UUID(result.game_id), users[1].id, correct_word)

    # Assert — correct answer gives positive points
    assert correct_result.correct is True
    assert correct_result.points_earned > 0


@pytest.mark.asyncio
async def test_mcq_one_answer_per_player_per_round(
    mcqquiz_game_controller: McqQuizGameController,
    setup_mcqquiz_game,
    session: AsyncSession,
):
    """Start 2-player MCQ quiz. Both submit answers. Verify: each player has exactly 1
    answer entry. Verify trying to answer again raises AlreadyAnsweredError."""
    # Prepare
    setup = await setup_mcqquiz_game(num_players=2)
    room, users = setup["room"], setup["users"]
    result = await _start_game(mcqquiz_game_controller, room.id, users[0].id)
    game = await _get_game(session, result.game_id)
    correct_index = game.live_state["current_question"]["correct_answer_index"]

    # Act — both players submit answers
    await mcqquiz_game_controller.submit_answer(UUID(result.game_id), users[0].id, correct_index)
    await mcqquiz_game_controller.submit_answer(UUID(result.game_id), users[1].id, (correct_index + 1) % 4)

    # Assert — each player has exactly 1 answer entry
    game = await _get_game(session, result.game_id)
    answers = game.live_state["answers"]
    assert str(users[0].id) in answers
    assert str(users[1].id) in answers
    assert len(answers) == 2

    # Assert — trying to answer again raises an error (RoundNotPlayingError if phase auto-transitioned,
    # or AlreadyAnsweredError if phase is still "playing")
    with pytest.raises((AlreadyAnsweredError, RoundNotPlayingError)):
        await mcqquiz_game_controller.submit_answer(UUID(result.game_id), users[0].id, correct_index)


@pytest.mark.asyncio
async def test_game_status_transitions_valid(
    undercover_game_controller: UndercoverGameController,
    setup_undercover_game,
    session: AsyncSession,
):
    """Start undercover game (IN_PROGRESS). Verify it starts as IN_PROGRESS.
    Then: for a 3-player game, advance through a full game cycle until it ends.
    Verify final status is FINISHED, never goes backwards."""
    # Prepare — 3-player game: 1 undercover, 2 civilians, 0 mr_white
    setup = await setup_undercover_game(3)
    room, users = setup["room"], setup["users"]
    result = await _start_game(undercover_game_controller, room.id, users[0].id)

    # Assert — game starts as IN_PROGRESS
    game = await _get_game(session, result.game_id)
    assert game.game_status == GameStatus.IN_PROGRESS

    # Act — advance to voting by submitting all descriptions
    game = await _advance_to_voting(undercover_game_controller, session, result.game_id)
    state = game.live_state
    game_uuid = UUID(result.game_id)

    # Find the undercover and vote them out (guarantees FINISHED with civilians win)
    undercover = next(p for p in state["players"] if p["role"] == UndercoverRole.UNDERCOVER.value)
    for user in users:
        if str(user.id) == undercover["user_id"]:
            # Undercover votes for someone else
            other = next(u for u in users if str(u.id) != undercover["user_id"])
            await undercover_game_controller.submit_vote(game_uuid, user.id, other.id)
        else:
            await undercover_game_controller.submit_vote(game_uuid, user.id, UUID(undercover["user_id"]))

    # Assert — game should be FINISHED (all undercovers eliminated, civilians win)
    game = await _get_game(session, result.game_id)
    assert game.game_status == GameStatus.FINISHED
    assert game.game_status != GameStatus.IN_PROGRESS
    assert game.game_status != GameStatus.WAITING


@pytest.mark.asyncio
async def test_room_owner_always_exists_if_room_active(
    undercover_game_controller: UndercoverGameController,
    setup_undercover_game,
    session: AsyncSession,
):
    """Use setup fixture, verify room.owner_id is in the users list.
    After game starts, verify owner still set."""
    # Prepare
    setup = await setup_undercover_game(3)
    room, users = setup["room"], setup["users"]
    user_ids = [str(u.id) for u in users]

    # Assert — room owner is in the users list
    assert room.owner_id is not None
    assert str(room.owner_id) in user_ids

    # Act — start the game
    await _start_game(undercover_game_controller, room.id, users[0].id)

    # Assert — owner is still set after game starts
    refreshed_room = (await session.exec(select(Room).where(Room.id == room.id))).first()
    assert refreshed_room.owner_id is not None
    assert str(refreshed_room.owner_id) in user_ids
