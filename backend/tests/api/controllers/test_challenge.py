from datetime import UTC, datetime, timedelta

from sqlmodel import select

from ipg.api.controllers.challenge import (
    CHALLENGE_DEFINITIONS,
    DAILY_CHALLENGE_COUNT,
    WEEKLY_CHALLENGE_COUNT,
    ChallengeController,
)
from ipg.api.models.challenge import ChallengeDefinition, UserChallenge


async def test_seed_challenges(challenge_controller: ChallengeController):
    """Seeding challenges creates exactly as many definitions as CHALLENGE_DEFINITIONS contains."""

    # Arrange — no prior definitions in the database

    # Act
    await challenge_controller.seed_challenges()

    # Assert
    result = await challenge_controller.session.exec(select(ChallengeDefinition))
    definitions = result.all()
    assert len(definitions) == len(CHALLENGE_DEFINITIONS)

    # Verify each seeded definition has a matching code in the source data
    db_codes = {d.code for d in definitions}
    expected_codes = {d["code"] for d in CHALLENGE_DEFINITIONS}
    assert db_codes == expected_codes


async def test_seed_challenges_idempotent(challenge_controller: ChallengeController):
    """Seeding challenges twice does not duplicate any definition records."""

    # Arrange
    await challenge_controller.seed_challenges()

    # Act
    await challenge_controller.seed_challenges()

    # Assert
    result = await challenge_controller.session.exec(select(ChallengeDefinition))
    definitions = result.all()
    assert len(definitions) == len(CHALLENGE_DEFINITIONS)


async def test_get_active_challenges_assigns_new(challenge_controller: ChallengeController, create_user):
    """For a new user with no challenges, get_active_challenges auto-assigns daily and weekly challenges."""

    # Arrange
    user = await create_user(username="newchallenger", email="newchallenger@test.com")
    await challenge_controller.seed_challenges()

    # Act
    active = await challenge_controller.get_active_challenges(user.id)

    # Assert — correct total count returned
    assert len(active) == DAILY_CHALLENGE_COUNT + WEEKLY_CHALLENGE_COUNT

    # Assert — correct split between daily and weekly
    daily = [c for c in active if c.challenge_type == "daily"]
    weekly = [c for c in active if c.challenge_type == "weekly"]
    assert len(daily) == DAILY_CHALLENGE_COUNT
    assert len(weekly) == WEEKLY_CHALLENGE_COUNT

    # Assert — all are incomplete with zero progress
    assert all(c.progress == 0 for c in active)
    assert all(not c.completed for c in active)

    # Assert — database state: UserChallenge rows were persisted
    db_result = await challenge_controller.session.exec(select(UserChallenge).where(UserChallenge.user_id == user.id))
    db_challenges = db_result.all()
    assert len(db_challenges) == DAILY_CHALLENGE_COUNT + WEEKLY_CHALLENGE_COUNT


async def test_get_active_challenges_returns_existing(challenge_controller: ChallengeController, create_user):
    """Already assigned challenges are returned without creating duplicates on subsequent calls."""

    # Arrange
    user = await create_user(username="existing", email="existing@test.com")
    await challenge_controller.seed_challenges()
    first_active = await challenge_controller.get_active_challenges(user.id)
    first_ids = {c.id for c in first_active}

    # Act
    second_active = await challenge_controller.get_active_challenges(user.id)
    second_ids = {c.id for c in second_active}

    # Assert — same challenges returned
    assert first_ids == second_ids
    assert len(second_active) == DAILY_CHALLENGE_COUNT + WEEKLY_CHALLENGE_COUNT

    # Assert — no extra rows in DB
    db_result = await challenge_controller.session.exec(select(UserChallenge).where(UserChallenge.user_id == user.id))
    db_challenges = db_result.all()
    assert len(db_challenges) == DAILY_CHALLENGE_COUNT + WEEKLY_CHALLENGE_COUNT


async def test_check_progress_play_condition(challenge_controller: ChallengeController, create_user):
    """Playing a game increments progress on challenges with the 'play' condition."""

    # Arrange — manually assign a known play-condition challenge
    user = await create_user(username="player", email="player@test.com")
    await challenge_controller.seed_challenges()

    defn_result = await challenge_controller.session.exec(
        select(ChallengeDefinition).where(ChallengeDefinition.code == "daily_play_any")
    )
    play_any_defn = defn_result.one()

    now = datetime.now(UTC)
    uc = UserChallenge(
        user_id=user.id,
        challenge_id=play_any_defn.id,
        progress=0,
        completed=False,
        assigned_at=now,
        expires_at=now + timedelta(days=1),
    )
    challenge_controller.session.add(uc)
    await challenge_controller.session.commit()
    await challenge_controller.session.refresh(uc)

    # Act
    await challenge_controller.check_progress(user_id=user.id, game_type="undercover", won=False, role=None)

    # Assert — the play challenge had its progress incremented
    db_result = await challenge_controller.session.exec(select(UserChallenge).where(UserChallenge.id == uc.id))
    refreshed = db_result.one()
    assert refreshed.progress == 1


async def test_check_progress_win_condition(challenge_controller: ChallengeController, create_user):
    """Winning a game increments 'win' challenges; losing does not increment them."""

    # Arrange — manually assign a known win-condition challenge
    user = await create_user(username="winner", email="winner@test.com")
    await challenge_controller.seed_challenges()

    defn_result = await challenge_controller.session.exec(
        select(ChallengeDefinition).where(ChallengeDefinition.code == "daily_win_any")
    )
    win_any_defn = defn_result.one()

    now = datetime.now(UTC)
    uc = UserChallenge(
        user_id=user.id,
        challenge_id=win_any_defn.id,
        progress=0,
        completed=False,
        assigned_at=now,
        expires_at=now + timedelta(days=1),
    )
    challenge_controller.session.add(uc)
    await challenge_controller.session.commit()
    await challenge_controller.session.refresh(uc)

    # Act — play a game but lose
    await challenge_controller.check_progress(user_id=user.id, game_type="undercover", won=False, role=None)

    # Assert — win challenge was NOT incremented
    db_result = await challenge_controller.session.exec(select(UserChallenge).where(UserChallenge.id == uc.id))
    refreshed = db_result.one()
    assert refreshed.progress == 0

    # Act — now play a game and win
    await challenge_controller.check_progress(user_id=user.id, game_type="undercover", won=True, role=None)

    # Assert — win challenge was incremented this time
    db_result_after_win = await challenge_controller.session.exec(
        select(UserChallenge).where(UserChallenge.id == uc.id)
    )
    refreshed_after_win = db_result_after_win.one()
    assert refreshed_after_win.progress == 1


async def test_check_progress_completes_challenge(challenge_controller: ChallengeController, create_user):
    """When progress reaches target_count, the challenge is marked as completed."""

    # Arrange — seed definitions and manually assign daily_play_any (target_count=1, condition="play")
    user = await create_user(username="completer", email="completer@test.com")
    await challenge_controller.seed_challenges()

    defn_result = await challenge_controller.session.exec(
        select(ChallengeDefinition).where(ChallengeDefinition.code == "daily_play_any")
    )
    play_any_defn = defn_result.one()

    now = datetime.now(UTC)
    uc = UserChallenge(
        user_id=user.id,
        challenge_id=play_any_defn.id,
        progress=0,
        completed=False,
        assigned_at=now,
        expires_at=now + timedelta(days=1),
    )
    challenge_controller.session.add(uc)
    await challenge_controller.session.commit()
    await challenge_controller.session.refresh(uc)

    # Act
    newly_completed = await challenge_controller.check_progress(
        user_id=user.id, game_type="undercover", won=False, role=None
    )

    # Assert — the challenge was newly completed (returned by check_progress)
    assert len(newly_completed) == 1
    assert newly_completed[0].completed is True
    assert newly_completed[0].code == "daily_play_any"
    assert newly_completed[0].progress >= play_any_defn.target_count

    # Assert — database state: the challenge is marked completed
    db_uc = await challenge_controller.session.exec(select(UserChallenge).where(UserChallenge.id == uc.id))
    refreshed = db_uc.one()
    assert refreshed.completed is True
    assert refreshed.progress == 1


async def test_check_progress_game_type_filter(challenge_controller: ChallengeController, create_user):
    """Game-type-specific challenges only match when the played game type matches."""

    # Arrange — manually assign one codenames-specific and one any-game challenge
    user = await create_user(username="typefilter", email="typefilter@test.com")
    await challenge_controller.seed_challenges()

    codenames_defn = (
        await challenge_controller.session.exec(
            select(ChallengeDefinition).where(ChallengeDefinition.code == "daily_play_codenames")
        )
    ).one()
    any_defn = (
        await challenge_controller.session.exec(
            select(ChallengeDefinition).where(ChallengeDefinition.code == "daily_play_any")
        )
    ).one()

    now = datetime.now(UTC)
    uc_codenames = UserChallenge(
        user_id=user.id,
        challenge_id=codenames_defn.id,
        progress=0,
        completed=False,
        assigned_at=now,
        expires_at=now + timedelta(days=1),
    )
    uc_any = UserChallenge(
        user_id=user.id,
        challenge_id=any_defn.id,
        progress=0,
        completed=False,
        assigned_at=now,
        expires_at=now + timedelta(days=1),
    )
    challenge_controller.session.add(uc_codenames)
    challenge_controller.session.add(uc_any)
    await challenge_controller.session.commit()
    await challenge_controller.session.refresh(uc_codenames)
    await challenge_controller.session.refresh(uc_any)

    # Act — play an "undercover" game (not codenames)
    await challenge_controller.check_progress(user_id=user.id, game_type="undercover", won=False, role=None)

    # Assert — codenames-specific challenge was NOT incremented
    refreshed_codenames = (
        await challenge_controller.session.exec(select(UserChallenge).where(UserChallenge.id == uc_codenames.id))
    ).one()
    assert refreshed_codenames.progress == 0, "Codenames challenge should not be incremented by an undercover game"

    # Assert — any-game challenge WAS incremented
    refreshed_any = (
        await challenge_controller.session.exec(select(UserChallenge).where(UserChallenge.id == uc_any.id))
    ).one()
    assert refreshed_any.progress == 1, "Any-game challenge should be incremented by an undercover game"
