import random
from uuid import UUID

from aredis_om import NotFoundError

from ibg.api.constants import (
    CODENAMES_ASSASSIN_CARDS,
    CODENAMES_BOARD_SIZE,
    CODENAMES_FIRST_TEAM_CARDS,
    CODENAMES_NEUTRAL_CARDS,
    CODENAMES_SECOND_TEAM_CARDS,
)
from ibg.api.models.error import GameNotFoundError, RoomNotFoundError
from ibg.api.schemas.error import BaseError
from ibg.socketio.models.codenames import (
    CodenamesCard,
    CodenamesCardType,
    CodenamesGame,
    CodenamesGameStatus,
    CodenamesPlayer,
    CodenamesRole,
    CodenamesTeam,
    CodenamesTurn,
)
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.shared import IBGSocket, redis_connection
from ibg.socketio.utils.redis_ttl import set_game_finished_ttl


class NotSpymasterError(BaseError):
    """Raised when a non-spymaster tries to give a clue."""

    def __init__(self, user_id: str):
        super().__init__(
            message=f"User {user_id} is not the spymaster for the current team",
            frontend_message="Only the spymaster can give clues.",
            status_code=403,
            details={"user_id": user_id},
        )


class NotOperativeError(BaseError):
    """Raised when a non-operative tries to guess a card."""

    def __init__(self, user_id: str):
        super().__init__(
            message=f"User {user_id} is not an operative for the current team",
            frontend_message="Only operatives can guess cards.",
            status_code=403,
            details={"user_id": user_id},
        )


class NotYourTurnError(BaseError):
    """Raised when a player acts out of turn."""

    def __init__(self, user_id: str):
        super().__init__(
            message=f"It is not user {user_id}'s team's turn",
            frontend_message="It's not your team's turn.",
            status_code=403,
            details={"user_id": user_id},
        )


class CardAlreadyRevealedError(BaseError):
    """Raised when trying to guess an already revealed card."""

    def __init__(self, card_index: int):
        super().__init__(
            message=f"Card at index {card_index} is already revealed",
            frontend_message="This card has already been revealed.",
            status_code=400,
            details={"card_index": card_index},
        )


class InvalidCardIndexError(BaseError):
    """Raised when the card index is out of range."""

    def __init__(self, card_index: int):
        super().__init__(
            message=f"Card index {card_index} is out of range (0-{CODENAMES_BOARD_SIZE - 1})",
            frontend_message="Invalid card selection.",
            status_code=400,
            details={"card_index": card_index},
        )


class NoClueGivenError(BaseError):
    """Raised when trying to guess before a clue has been given."""

    def __init__(self):
        super().__init__(
            message="No clue has been given yet for this turn",
            frontend_message="Wait for the spymaster to give a clue first.",
            status_code=400,
        )


class GameNotInProgressError(BaseError):
    """Raised when trying to take an action on a game that is not in progress."""

    def __init__(self, game_id: str):
        super().__init__(
            message=f"Game {game_id} is not in progress",
            frontend_message="This game is not currently in progress.",
            status_code=400,
            details={"game_id": game_id},
        )


class NotEnoughPlayersError(BaseError):
    """Raised when there are not enough players to start a Codenames game."""

    def __init__(self, player_count: int):
        super().__init__(
            message=f"Need at least 4 players for Codenames, got {player_count}",
            frontend_message="At least 4 players are needed to start Codenames.",
            status_code=400,
            details={"player_count": player_count},
        )


class ClueWordIsOnBoardError(BaseError):
    """Raised when the clue word matches a word on the board."""

    def __init__(self, clue_word: str):
        super().__init__(
            message=f"Clue word '{clue_word}' is on the board and cannot be used as a clue",
            frontend_message="Your clue word cannot be a word that's on the board.",
            status_code=400,
            details={"clue_word": clue_word},
        )


async def get_codenames_game(game_id: str) -> CodenamesGame:
    """Retrieve a Codenames game from Redis by ID.

    :param game_id: The game ID string.
    :return: The CodenamesGame instance.
    :raises GameNotFoundError: If the game is not found.
    """
    try:
        return await CodenamesGame.get(game_id)
    except NotFoundError:
        raise GameNotFoundError(game_id=game_id)


def get_player_from_game(game: CodenamesGame, user_id: str) -> CodenamesPlayer:
    """Find a player in the game by user_id.

    :param game: The Codenames game.
    :param user_id: The user ID string.
    :return: The CodenamesPlayer.
    :raises ValueError: If the player is not found in the game.
    """
    for player in game.players:
        if str(player.user_id) == user_id:
            return player
    raise ValueError(f"Player with user_id {user_id} not found in game")


def build_board(words: list[str], first_team: CodenamesTeam) -> list[CodenamesCard]:
    """Build a 25-card Codenames board with assigned card types.

    :param words: List of 25 words.
    :param first_team: The team that goes first (gets 9 cards).
    :return: List of 25 CodenamesCard objects.
    """
    second_team = CodenamesTeam.BLUE if first_team == CodenamesTeam.RED else CodenamesTeam.RED

    first_team_card_type = CodenamesCardType(first_team.value)
    second_team_card_type = CodenamesCardType(second_team.value)

    card_types = (
        [first_team_card_type] * CODENAMES_FIRST_TEAM_CARDS
        + [second_team_card_type] * CODENAMES_SECOND_TEAM_CARDS
        + [CodenamesCardType.NEUTRAL] * CODENAMES_NEUTRAL_CARDS
        + [CodenamesCardType.ASSASSIN] * CODENAMES_ASSASSIN_CARDS
    )
    random.shuffle(card_types)

    board = []
    for word, card_type in zip(words, card_types):
        board.append(CodenamesCard(word=word, card_type=card_type, revealed=False))

    return board


def assign_players(room_users: list, first_team: CodenamesTeam) -> list[CodenamesPlayer]:
    """Assign players to teams and roles for a Codenames game.

    Each team gets exactly one spymaster, rest are operatives.
    Players are distributed as evenly as possible between teams.

    :param room_users: List of Redis User objects from the room.
    :param first_team: The team that goes first.
    :return: List of CodenamesPlayer objects.
    """
    second_team = CodenamesTeam.BLUE if first_team == CodenamesTeam.RED else CodenamesTeam.RED

    shuffled_users = list(room_users)
    random.shuffle(shuffled_users)

    mid = len(shuffled_users) // 2
    # First team gets the slightly larger group if odd number of players
    first_team_users = shuffled_users[: mid + (len(shuffled_users) % 2)]
    second_team_users = shuffled_users[mid + (len(shuffled_users) % 2) :]

    players = []

    # Assign first team
    for i, user in enumerate(first_team_users):
        role = CodenamesRole.SPYMASTER if i == 0 else CodenamesRole.OPERATIVE
        players.append(
            CodenamesPlayer(
                sid=user.sid,
                user_id=user.id,
                username=user.username,
                team=first_team,
                role=role,
            )
        )

    # Assign second team
    for i, user in enumerate(second_team_users):
        role = CodenamesRole.SPYMASTER if i == 0 else CodenamesRole.OPERATIVE
        players.append(
            CodenamesPlayer(
                sid=user.sid,
                user_id=user.id,
                username=user.username,
                team=second_team,
                role=role,
            )
        )

    return players


async def start_codenames_game(
    sio: IBGSocket,
    room_id: UUID,
    user_id: UUID,
    word_pack_ids: list[UUID] | None = None,
) -> CodenamesGame:
    """Start a new Codenames game in the given room.

    Generates a 25-word board from the database, assigns card types,
    assigns players to teams and roles, and saves the game to Redis.

    :param sio: The IBGSocket server instance.
    :param room_id: The room UUID.
    :param user_id: The user UUID who initiated the game.
    :param word_pack_ids: Optional list of word pack IDs to draw words from.
    :return: The created CodenamesGame.
    """
    from ibg.api.controllers.codenames import NotEnoughWordsError
    from ibg.api.models.game import GameCreate, GameType

    db_room = await sio.room_controller.get_room_by_id(room_id)

    async with redis_connection.lock(f"room:{db_room.id}:start", timeout=10):
        async with redis_connection.lock(f"room:{db_room.id}:join", timeout=5):
            try:
                redis_room = await RedisRoom.get(str(db_room.id))
            except NotFoundError:
                raise RoomNotFoundError(room_id=room_id)

            # Prevent double-start
            if redis_room.active_game_id:
                from ibg.api.schemas.error import BaseError
                raise BaseError(
                    message=f"Room {room_id} already has an active game",
                    frontend_message="A game is already in progress.",
                    status_code=400,
                )

            room_users = redis_room.users

        if len(room_users) < 4:
            raise NotEnoughPlayersError(player_count=len(room_users))

        # Get random words from DB
        codenames_controller = sio.codenames_controller
        try:
            random_words = await codenames_controller.get_random_words(
                count=CODENAMES_BOARD_SIZE,
                pack_ids=word_pack_ids,
            )
        except NotEnoughWordsError:
            raise

        word_strings = [w.word for w in random_words]

        # Randomly decide which team goes first
        first_team = random.choice([CodenamesTeam.RED, CodenamesTeam.BLUE])

        # Build the board
        board = build_board(word_strings, first_team)

        # Assign players to teams and roles
        players = assign_players(room_users, first_team)

        # Count cards per team
        red_remaining = sum(1 for card in board if card.card_type == CodenamesCardType.RED)
        blue_remaining = sum(1 for card in board if card.card_type == CodenamesCardType.BLUE)

        # Create DB game record
        db_game = await sio.game_controller.create_game(
            GameCreate(
                room_id=db_room.id,
                number_of_players=len(room_users),
                type=GameType.CODENAMES,
                game_configurations={
                    "first_team": first_team.value,
                    "word_pack_ids": [str(pid) for pid in word_pack_ids] if word_pack_ids else [],
                    "board_words": word_strings,
                },
            )
        )

        # Create Redis game state
        redis_game = CodenamesGame(
            pk=str(db_game.id),
            room_id=str(db_room.id),
            id=str(db_game.id),
            board=board,
            players=players,
            current_team=first_team,
            current_turn=CodenamesTurn(team=first_team),
            red_remaining=red_remaining,
            blue_remaining=blue_remaining,
            status=CodenamesGameStatus.IN_PROGRESS,
        )
        await redis_game.save()

        # Track active game on the room
        redis_room.active_game_id = str(db_game.id)
        redis_room.active_game_type = "codenames"
        await redis_room.save()

    return redis_game


async def give_clue(
    game_id: str,
    user_id: str,
    clue_word: str,
    clue_number: int,
) -> CodenamesGame:
    """Process a spymaster giving a clue.

    :param game_id: The game ID string.
    :param user_id: The user ID of the spymaster.
    :param clue_word: The one-word clue.
    :param clue_number: The number associated with the clue.
    :return: The updated CodenamesGame.
    :raises GameNotInProgressError: If the game is not in progress.
    :raises NotSpymasterError: If the user is not the spymaster for the current team.
    :raises ClueWordIsOnBoardError: If the clue word is on the board.
    """
    async with redis_connection.lock(f"game:{game_id}:state", timeout=30):
        game = await get_codenames_game(game_id)

        if game.status != CodenamesGameStatus.IN_PROGRESS:
            raise GameNotInProgressError(game_id=game_id)

        player = get_player_from_game(game, user_id)

        if player.team != game.current_team:
            raise NotYourTurnError(user_id=user_id)

        if player.role != CodenamesRole.SPYMASTER:
            raise NotSpymasterError(user_id=user_id)

        # Validate clue word is not on the board
        board_words_lower = [card.word.lower() for card in game.board]
        if clue_word.lower() in board_words_lower:
            raise ClueWordIsOnBoardError(clue_word=clue_word)

        # Set the clue on the current turn
        game.current_turn = CodenamesTurn(
            team=game.current_team,
            clue_word=clue_word,
            clue_number=clue_number,
            guesses_made=0,
            max_guesses=clue_number + 1,  # operatives get clue_number + 1 guesses
        )
        await game.save()

    return game


async def guess_card(
    game_id: str,
    user_id: str,
    card_index: int,
) -> tuple[CodenamesGame, CodenamesCard, str]:
    """Process an operative guessing a card.

    :param game_id: The game ID string.
    :param user_id: The user ID of the operative.
    :param card_index: The index of the card to guess (0-24).
    :return: Tuple of (updated game, revealed card, result message).
    :raises GameNotInProgressError: If the game is not in progress.
    :raises NotOperativeError: If the user is not an operative for the current team.
    :raises NoClueGivenError: If no clue has been given yet.
    :raises InvalidCardIndexError: If the card index is out of range.
    :raises CardAlreadyRevealedError: If the card is already revealed.
    """
    async with redis_connection.lock(f"game:{game_id}:state", timeout=30):
        game = await get_codenames_game(game_id)

        if game.status != CodenamesGameStatus.IN_PROGRESS:
            raise GameNotInProgressError(game_id=game_id)

        player = get_player_from_game(game, user_id)

        if player.team != game.current_team:
            raise NotYourTurnError(user_id=user_id)

        if player.role != CodenamesRole.OPERATIVE:
            raise NotOperativeError(user_id=user_id)

        if game.current_turn is None or game.current_turn.clue_word is None:
            raise NoClueGivenError()

        if card_index < 0 or card_index >= CODENAMES_BOARD_SIZE:
            raise InvalidCardIndexError(card_index=card_index)

        card = game.board[card_index]

        if card.revealed:
            raise CardAlreadyRevealedError(card_index=card_index)

        # Reveal the card
        card.revealed = True
        game.current_turn.guesses_made += 1

        result = ""

        if card.card_type == CodenamesCardType.ASSASSIN:
            # Guessing team loses immediately
            game.status = CodenamesGameStatus.FINISHED
            other_team = CodenamesTeam.BLUE if game.current_team == CodenamesTeam.RED else CodenamesTeam.RED
            game.winner = other_team
            result = "assassin"

        elif card.card_type.value == game.current_team.value:
            # Correct guess - own team's card
            if game.current_team == CodenamesTeam.RED:
                game.red_remaining -= 1
                if game.red_remaining == 0:
                    game.status = CodenamesGameStatus.FINISHED
                    game.winner = CodenamesTeam.RED
                    result = "win"
                elif game.current_turn.guesses_made >= game.current_turn.max_guesses:
                    # Used all guesses, switch turn
                    result = "max_guesses"
                else:
                    result = "correct"
            else:
                game.blue_remaining -= 1
                if game.blue_remaining == 0:
                    game.status = CodenamesGameStatus.FINISHED
                    game.winner = CodenamesTeam.BLUE
                    result = "win"
                elif game.current_turn.guesses_made >= game.current_turn.max_guesses:
                    result = "max_guesses"
                else:
                    result = "correct"

        elif card.card_type.value != game.current_team.value and card.card_type != CodenamesCardType.NEUTRAL:
            # Opponent's card - turn ends and decrement opponent's remaining
            other_team = CodenamesTeam.BLUE if game.current_team == CodenamesTeam.RED else CodenamesTeam.RED
            if other_team == CodenamesTeam.RED:
                game.red_remaining -= 1
                if game.red_remaining == 0:
                    game.status = CodenamesGameStatus.FINISHED
                    game.winner = CodenamesTeam.RED
                    result = "opponent_wins"
                else:
                    result = "opponent_card"
            else:
                game.blue_remaining -= 1
                if game.blue_remaining == 0:
                    game.status = CodenamesGameStatus.FINISHED
                    game.winner = CodenamesTeam.BLUE
                    result = "opponent_wins"
                else:
                    result = "opponent_card"

        else:
            # Neutral card - turn ends
            result = "neutral"

        # If turn should end (not a correct guess or max guesses reached), switch teams
        if result in ("opponent_card", "neutral", "max_guesses") and game.status == CodenamesGameStatus.IN_PROGRESS:
            _switch_turn(game)

        await game.save()

        # Set TTL on finished games so they don't persist forever
        if game.status == CodenamesGameStatus.FINISHED:
            await set_game_finished_ttl(game)
            # Clear active game on the room
            try:
                redis_room = await RedisRoom.get(game.room_id)
                redis_room.active_game_id = None
                redis_room.active_game_type = None
                await redis_room.save()
            except NotFoundError:
                pass

    return game, card, result


async def end_turn(
    game_id: str,
    user_id: str,
) -> CodenamesGame:
    """Allow an operative to voluntarily end their turn.

    :param game_id: The game ID string.
    :param user_id: The user ID of the operative.
    :return: The updated CodenamesGame.
    :raises GameNotInProgressError: If the game is not in progress.
    :raises NotOperativeError: If the user is not an operative for the current team.
    """
    async with redis_connection.lock(f"game:{game_id}:state", timeout=30):
        game = await get_codenames_game(game_id)

        if game.status != CodenamesGameStatus.IN_PROGRESS:
            raise GameNotInProgressError(game_id=game_id)

        player = get_player_from_game(game, user_id)

        if player.team != game.current_team:
            raise NotYourTurnError(user_id=user_id)

        if player.role != CodenamesRole.OPERATIVE:
            raise NotOperativeError(user_id=user_id)

        _switch_turn(game)
        await game.save()

    return game


def get_board_for_player(game: CodenamesGame, user_id: str) -> list[dict]:
    """Get the board state appropriate for the player's role.

    Spymasters see all card types. Operatives only see revealed cards' types.

    :param game: The Codenames game.
    :param user_id: The user ID string.
    :return: List of card dictionaries with appropriate visibility.
    """
    player = get_player_from_game(game, user_id)

    board_view = []
    for i, card in enumerate(game.board):
        card_data = {
            "index": i,
            "word": card.word,
            "revealed": card.revealed,
        }

        if player.role == CodenamesRole.SPYMASTER or card.revealed:
            card_data["card_type"] = card.card_type.value
        else:
            card_data["card_type"] = None

        board_view.append(card_data)

    return board_view


def _switch_turn(game: CodenamesGame) -> None:
    """Switch the current turn to the other team.

    :param game: The Codenames game to update in place.
    """
    next_team = CodenamesTeam.BLUE if game.current_team == CodenamesTeam.RED else CodenamesTeam.RED
    game.current_team = next_team
    game.current_turn = CodenamesTurn(team=next_team)
