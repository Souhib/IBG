import random
from uuid import UUID

from aredis_om import NotFoundError

from ibg.api.models.error import (
    CantVoteBecauseYouDeadError,
    CantVoteForDeadPersonError,
    CantVoteForYourselfError,
    RoomNotFoundError,
)
from ibg.api.models.event import EventCreate
from ibg.api.models.game import GameCreate, GameType
from ibg.api.models.table import Game, Room
from ibg.api.models.undercover import UndercoverRole, Word
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.shared import IBGSocket, redis_connection
from ibg.socketio.models.socket import StartGame, UndercoverGame, UndercoverTurn, VoteForAPerson
from ibg.socketio.models.user import UndercoverSocketPlayer
from ibg.socketio.utils.redis_ttl import set_game_finished_ttl


async def get_civilian_and_undercover_words(sio: IBGSocket) -> tuple[Word, Word]:
    """Get the civilian and undercover words for the game."""
    term_pair = await sio.undercover_controller.get_random_term_pair()
    civilian_word_id = term_pair.word1_id
    undercover_word_id = term_pair.word2_id
    if random.choice([True, False]):
        civilian_word_id, undercover_word_id = (
            term_pair.word2_id,
            term_pair.word1_id,
        )
    civilian_word = await sio.undercover_controller.get_word_by_id(civilian_word_id)
    undercover_word = await sio.undercover_controller.get_word_by_id(undercover_word_id)
    return civilian_word, undercover_word


async def start_new_turn(sio: IBGSocket, db_room: Room, db_game: Game, redis_game: UndercoverGame) -> None:
    """Start a new turn in the game."""
    turn = await sio.game_controller.create_turn(game_id=db_game.id)
    await sio.game_controller.create_turn_event(
        game_id=db_game.id,
        event_create=EventCreate(
            name="start_turn",
            data={
                "game_id": str(db_game.id),
                "turn_id": str(turn.id),
                "message": f"Turn {turn.id} started.",
            },
            user_id=db_room.owner_id,
        ),
    )
    redis_game.turns.append(UndercoverTurn())
    await redis_game.save()


async def create_undercover_game(
    sio: IBGSocket,
    start_game_input: StartGame,
) -> tuple[Room, Game, UndercoverGame]:
    """Create an undercover game, assign roles to players, and save the game to Redis."""
    db_room = await sio.room_controller.get_room_by_id(start_game_input.room_id)
    async with redis_connection.lock(f"room:{db_room.id}:join", timeout=5):
        try:
            room = await RedisRoom.get(str(db_room.id))
        except NotFoundError:
            raise RoomNotFoundError(room_id=start_game_input.room_id) from None
        players = room.users
    num_players = len(players)
    num_mr_white = 1 if num_players < 10 else (2 if num_players <= 15 else 3)
    num_undercover = max(2, num_players // 4)
    num_civilians = num_players - num_mr_white - num_undercover
    roles = (
        [UndercoverRole.UNDERCOVER] * num_undercover
        + [UndercoverRole.CIVILIAN] * num_civilians
        + [UndercoverRole.MR_WHITE] * num_mr_white
    )
    random.shuffle(roles)
    undercover_players = [
        UndercoverSocketPlayer(user_id=player.id, username=player.username, role=role, sid=player.sid)
        for player, role in zip(players, roles)
    ]
    undercover_players[random.randint(0, len(undercover_players) - 1)].is_mayor = True
    civilian_word, undercover_word = await get_civilian_and_undercover_words(sio)
    db_game = await sio.game_controller.create_game(
        GameCreate(
            room_id=db_room.id,
            number_of_players=len(players),
            type=GameType.UNDERCOVER,
            game_configurations={
                "civilian_word": civilian_word.word,
                "undercover_word": undercover_word.word,
                "civilian_word_id": str(civilian_word.id),
                "undercover_word_id": str(undercover_word.id),
            },
        )
    )
    redis_game = UndercoverGame(
        pk=str(db_game.id),
        civilian_word=civilian_word.word,
        undercover_word=undercover_word.word,
        room_id=str(db_room.id),
        id=str(db_game.id),
        players=undercover_players,
    )
    await redis_game.save()

    # Track active game on the room
    room.active_game_id = str(db_game.id)
    room.active_game_type = "undercover"
    await room.save()

    await start_new_turn(sio, db_room, db_game, redis_game)
    return db_room, db_game, redis_game


async def eliminate_player_based_on_votes(
    game: UndercoverGame,
) -> tuple[UndercoverSocketPlayer, int]:
    """Eliminate the player with the most votes in the game."""
    votes = game.turns[-1].votes
    vote_counts = {player.user_id: 0 for player in game.players}
    for voted_id in votes.values():
        vote_counts[voted_id] += 1

    # Get the player with the most votes
    max_votes = max(vote_counts.values())
    players_with_max_votes = [player_id for player_id, vote_count in vote_counts.items() if vote_count == max_votes]

    # If there is a tie, check if the mayor's vote can break the tie
    if len(players_with_max_votes) > 1:
        mayor_vote = next(
            (votes.get(player.user_id) for player in game.players if player.is_mayor),
            None,
        )
        if mayor_vote in players_with_max_votes:
            player_with_most_vote = mayor_vote
        else:
            player_with_most_vote = players_with_max_votes[0]
    else:
        player_with_most_vote = players_with_max_votes[0]

    eliminated_player = next(player for player in game.players if player.user_id == player_with_most_vote)
    eliminated_player.is_alive = False
    game.eliminated_players.append(eliminated_player)
    await game.save()

    return eliminated_player, vote_counts[player_with_most_vote]


async def set_vote(
    game: UndercoverGame, data: VoteForAPerson
) -> tuple[UndercoverSocketPlayer, UndercoverSocketPlayer, UndercoverGame, bool]:
    """Validate and record a vote. Uses a Redis lock for atomicity.

    Returns (voter, voted_for, game, all_voted) where all_voted is True only
    when this vote was the last one needed. Computed inside the lock to prevent
    double-elimination race conditions.
    """
    async with redis_connection.lock(f"game:{data.game_id}:vote", timeout=5):
        # Re-fetch game inside lock to get latest state
        game = await UndercoverGame.get(data.game_id)

        player_to_vote: UndercoverSocketPlayer = next(
            player for player in game.players if str(player.user_id) == data.user_id
        )
        if player_to_vote.is_alive is False:
            raise CantVoteBecauseYouDeadError(user_id=data.user_id)
        voted_player: UndercoverSocketPlayer = next(
            player for player in game.players if str(player.user_id) == data.voted_user_id
        )
        if voted_player.is_alive is False:
            raise CantVoteForDeadPersonError(
                user_id=data.user_id,
                dead_user_id=data.voted_user_id,
            )
        if player_to_vote.user_id == voted_player.user_id:
            raise CantVoteForYourselfError(user_id=data.user_id)
        game.turns[-1].votes[UUID(data.user_id)] = voted_player.user_id
        await game.save()

        # Check if all alive players have voted (inside lock for atomicity)
        alive_count = sum(1 for p in game.players if p.is_alive)
        all_voted = len(game.turns[-1].votes) == alive_count

    return player_to_vote, voted_player, game, all_voted


def get_winning_team(game: UndercoverGame) -> UndercoverRole | None:
    """Determine if a team has won based on alive player counts.

    Returns the winning role or None if the game is still in progress.
    """
    num_alive_undercover = sum(
        1 for p in game.players if p.role == UndercoverRole.UNDERCOVER and p.is_alive
    )
    num_alive_civilian = sum(
        1 for p in game.players if p.role == UndercoverRole.CIVILIAN and p.is_alive
    )
    num_alive_mr_white = sum(
        1 for p in game.players if p.role == UndercoverRole.MR_WHITE and p.is_alive
    )
    if num_alive_undercover == 0 and num_alive_mr_white == 0:
        return UndercoverRole.CIVILIAN
    if num_alive_civilian == 0 or num_alive_mr_white == 0:
        return UndercoverRole.UNDERCOVER
    return None


async def check_if_a_team_has_win(game: UndercoverGame) -> UndercoverRole | None:
    """Check if a team has won the game.

    If a team has won, also clears the active_game_id on the Redis room.
    """
    winner = get_winning_team(game)

    if winner:
        await set_game_finished_ttl(game)
        # Clear active game on the room
        try:
            redis_room = await RedisRoom.get(game.room_id)
            redis_room.active_game_id = None
            redis_room.active_game_type = None
            await redis_room.save()
        except NotFoundError:
            pass

    return winner
