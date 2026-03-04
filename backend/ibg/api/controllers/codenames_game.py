import random
from uuid import UUID

from aredis_om import NotFoundError
from sqlmodel.ext.asyncio.session import AsyncSession

from ibg.api.constants import CODENAMES_BOARD_SIZE
from ibg.api.controllers.codenames import CodenamesController
from ibg.api.controllers.game import GameController
from ibg.api.controllers.notification import NotificationService
from ibg.api.controllers.room import RoomController
from ibg.api.models.error import GameNotFoundError, RoomNotFoundError
from ibg.api.models.game import GameCreate, GameType
from ibg.api.schemas.error import BaseError
from ibg.socketio.controllers.codenames import (
    CardAlreadyRevealedError,
    ClueWordIsOnBoardError,
    GameNotInProgressError,
    InvalidCardIndexError,
    NoClueGivenError,
    NotEnoughPlayersError,
    NotOperativeError,
    NotSpymasterError,
    NotYourTurnError,
    assign_players,
    build_board,
    get_board_for_player,
    get_player_from_game,
)
from ibg.socketio.models.codenames import (
    CodenamesCardType,
    CodenamesGame,
    CodenamesGameStatus,
    CodenamesRole,
    CodenamesTeam,
    CodenamesTurn,
)
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.shared import redis_connection
from ibg.socketio.utils.disconnect_tasks import cancel_disconnect_cleanup
from ibg.socketio.utils.redis_ttl import set_game_finished_ttl


class CodenamesGameController:
    """REST-callable controller for Codenames game logic.

    Extracted from ibg/socketio/controllers/codenames.py.
    Same logic, same Redis locks, but callable from REST routes via Depends().
    """

    def __init__(
        self,
        session: AsyncSession,
        notifier: NotificationService,
    ):
        self.session = session
        self.notifier = notifier
        self._room_controller = RoomController(session)
        self._game_controller = GameController(session)
        self._codenames_controller = CodenamesController(session)

    async def create_and_start(
        self,
        room_id: UUID,
        user_id: UUID,
        word_pack_ids: list[UUID] | None = None,
    ) -> dict:
        """Start a new Codenames game in the given room."""
        db_room = await self._room_controller.get_room_by_id(room_id)

        async with redis_connection.lock(f"room:{db_room.id}:start", timeout=10):
            async with redis_connection.lock(f"room:{db_room.id}:join", timeout=5):
                try:
                    redis_room = await RedisRoom.get(str(db_room.id))
                except NotFoundError:
                    raise RoomNotFoundError(room_id=room_id) from None

                if redis_room.active_game_id:
                    raise BaseError(
                        message=f"Room {room_id} already has an active game",
                        frontend_message="A game is already in progress.",
                        status_code=400,
                    )

                room_users = redis_room.users

            if len(room_users) < 4:
                raise NotEnoughPlayersError(player_count=len(room_users))

            random_words = await self._codenames_controller.get_random_words(
                count=CODENAMES_BOARD_SIZE,
                pack_ids=word_pack_ids,
            )
            word_strings = [w.word for w in random_words]

            first_team = random.choice([CodenamesTeam.RED, CodenamesTeam.BLUE])
            board = build_board(word_strings, first_team)
            players = assign_players(room_users, first_team)

            red_remaining = sum(1 for card in board if card.card_type == CodenamesCardType.RED)
            blue_remaining = sum(1 for card in board if card.card_type == CodenamesCardType.BLUE)

            db_game = await self._game_controller.create_game(
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

            redis_room.active_game_id = str(db_game.id)
            redis_room.active_game_type = "codenames"
            await redis_room.save()

        # Notify each player with their role and board view
        for player in redis_game.players:
            board_view = get_board_for_player(redis_game, str(player.user_id))
            if player.sid:
                await self.notifier.emit(
                    "codenames_game_started",
                    {
                        "game_id": redis_game.id,
                        "game_type": "codenames",
                        "team": player.team.value,
                        "role": player.role.value,
                        "current_team": redis_game.current_team.value,
                        "red_remaining": redis_game.red_remaining,
                        "blue_remaining": redis_game.blue_remaining,
                        "board": board_view,
                        "players": [
                            {
                                "user_id": str(p.user_id),
                                "username": p.username,
                                "team": p.team.value,
                                "role": p.role.value,
                            }
                            for p in redis_game.players
                        ],
                    },
                    to=player.sid,
                )

        return {
            "game_id": str(db_game.id),
            "room_id": str(db_room.id),
        }

    async def give_clue(self, game_id: UUID, user_id: UUID, clue_word: str, clue_number: int) -> dict:
        """Process a spymaster giving a clue."""
        async with redis_connection.lock(f"game:{game_id}:state", timeout=30):
            game = await self._get_game(game_id)

            if game.status != CodenamesGameStatus.IN_PROGRESS:
                raise GameNotInProgressError(game_id=str(game_id))

            player = get_player_from_game(game, str(user_id))

            if player.team != game.current_team:
                raise NotYourTurnError(user_id=str(user_id))
            if player.role != CodenamesRole.SPYMASTER:
                raise NotSpymasterError(user_id=str(user_id))

            board_words_lower = [card.word.lower() for card in game.board]
            if clue_word.lower() in board_words_lower:
                raise ClueWordIsOnBoardError(clue_word=clue_word)

            game.current_turn = CodenamesTurn(
                team=game.current_team,
                clue_word=clue_word,
                clue_number=clue_number,
                guesses_made=0,
                max_guesses=clue_number + 1,
            )
            await game.save()

        # Notify all players
        clue_payload = {
            "game_id": game.id,
            "team": game.current_team.value,
            "clue_word": clue_word,
            "clue_number": clue_number,
            "max_guesses": game.current_turn.max_guesses,
        }
        await self.notifier.emit_to_players("codenames_clue_given", clue_payload, game.players)

        return {
            "game_id": str(game_id),
            "clue_word": clue_word,
            "clue_number": clue_number,
        }

    async def guess_card(self, game_id: UUID, user_id: UUID, card_index: int) -> dict:
        """Process an operative guessing a card."""
        async with redis_connection.lock(f"game:{game_id}:state", timeout=30):
            game = await self._get_game(game_id)
            self._validate_guess(game, str(user_id), card_index)

            card = game.board[card_index]
            card.revealed = True
            game.current_turn.guesses_made += 1

            result = self._resolve_card(game, card)

            if result in ("opponent_card", "neutral", "max_guesses") and game.status == CodenamesGameStatus.IN_PROGRESS:
                self._switch_turn(game)

            await game.save()

            if game.status == CodenamesGameStatus.FINISHED:
                await self._handle_game_finished(game)

        await self._notify_guess(game, card_index, card, result)

        return {
            "game_id": str(game_id),
            "card_index": card_index,
            "card_type": card.card_type.value,
            "result": result,
        }

    async def _get_game(self, game_id: UUID) -> CodenamesGame:
        """Fetch a CodenamesGame from Redis or raise GameNotFoundError."""
        try:
            return await CodenamesGame.get(str(game_id))
        except NotFoundError:
            raise GameNotFoundError(game_id=game_id) from None

    def _validate_guess(self, game: CodenamesGame, user_id: str, card_index: int) -> None:
        """Validate that the guess is legal."""
        if game.status != CodenamesGameStatus.IN_PROGRESS:
            raise GameNotInProgressError(game_id=game.id)
        player = get_player_from_game(game, user_id)
        if player.team != game.current_team:
            raise NotYourTurnError(user_id=user_id)
        if player.role != CodenamesRole.OPERATIVE:
            raise NotOperativeError(user_id=user_id)
        if game.current_turn is None or game.current_turn.clue_word is None:
            raise NoClueGivenError()
        if card_index < 0 or card_index >= CODENAMES_BOARD_SIZE:
            raise InvalidCardIndexError(card_index=card_index)
        if game.board[card_index].revealed:
            raise CardAlreadyRevealedError(card_index=card_index)

    def _resolve_card(self, game: CodenamesGame, card) -> str:
        """Resolve what happens when a card is revealed. Returns a result string."""
        if card.card_type == CodenamesCardType.ASSASSIN:
            return self._resolve_assassin(game)
        if card.card_type.value == game.current_team.value:
            return self._resolve_own_card(game)
        if card.card_type != CodenamesCardType.NEUTRAL:
            return self._resolve_opponent_card(game)
        return "neutral"

    def _resolve_assassin(self, game: CodenamesGame) -> str:
        """Handle assassin card reveal."""
        game.status = CodenamesGameStatus.FINISHED
        game.winner = CodenamesTeam.BLUE if game.current_team == CodenamesTeam.RED else CodenamesTeam.RED
        return "assassin"

    def _resolve_own_card(self, game: CodenamesGame) -> str:
        """Handle guessing a card belonging to the current team."""
        remaining = self._decrement_remaining(game, game.current_team)
        if remaining == 0:
            game.status = CodenamesGameStatus.FINISHED
            game.winner = game.current_team
            return "win"
        if game.current_turn.guesses_made >= game.current_turn.max_guesses:
            return "max_guesses"
        return "correct"

    def _resolve_opponent_card(self, game: CodenamesGame) -> str:
        """Handle guessing a card belonging to the opponent team."""
        other_team = CodenamesTeam.BLUE if game.current_team == CodenamesTeam.RED else CodenamesTeam.RED
        remaining = self._decrement_remaining(game, other_team)
        if remaining == 0:
            game.status = CodenamesGameStatus.FINISHED
            game.winner = other_team
            return "opponent_wins"
        return "opponent_card"

    def _decrement_remaining(self, game: CodenamesGame, team: CodenamesTeam) -> int:
        """Decrement the remaining card count for a team and return the new count."""
        if team == CodenamesTeam.RED:
            game.red_remaining -= 1
            return game.red_remaining
        game.blue_remaining -= 1
        return game.blue_remaining

    async def _handle_game_finished(self, game: CodenamesGame) -> None:
        """Clean up after a game finishes: set TTL, clear room's active game."""
        await set_game_finished_ttl(game)
        try:
            redis_room = await RedisRoom.get(game.room_id)
            redis_room.active_game_id = None
            redis_room.active_game_type = None
            await redis_room.save()
        except NotFoundError:
            pass

    async def _notify_guess(self, game: CodenamesGame, card_index: int, card, result: str) -> None:
        """Send notifications to all players after a guess."""
        for p in game.players:
            board_view = get_board_for_player(game, str(p.user_id))
            if p.sid:
                await self.notifier.emit(
                    "codenames_card_revealed",
                    {
                        "game_id": game.id,
                        "card_index": card_index,
                        "card_word": card.word,
                        "card_type": card.card_type.value,
                        "result": result,
                        "current_team": game.current_team.value,
                        "red_remaining": game.red_remaining,
                        "blue_remaining": game.blue_remaining,
                        "guesses_made": game.current_turn.guesses_made if game.current_turn else 0,
                        "max_guesses": game.current_turn.max_guesses if game.current_turn else 0,
                        "board": board_view,
                    },
                    to=p.sid,
                )

        if game.status == CodenamesGameStatus.FINISHED:
            full_board = [
                {"index": i, "word": c.word, "card_type": c.card_type.value, "revealed": c.revealed}
                for i, c in enumerate(game.board)
            ]
            await self.notifier.emit_to_players(
                "codenames_game_over",
                {"game_id": game.id, "winner": game.winner.value if game.winner else None, "reason": result, "board": full_board},
                game.players,
            )
        elif result in ("opponent_card", "neutral", "max_guesses"):
            await self.notifier.emit_to_players(
                "codenames_turn_ended",
                {"game_id": game.id, "reason": result, "current_team": game.current_team.value},
                game.players,
            )

    async def end_turn(self, game_id: UUID, user_id: UUID) -> dict:
        """Allow an operative to voluntarily end their turn."""
        async with redis_connection.lock(f"game:{game_id}:state", timeout=30):
            game = await self._get_game(game_id)

            if game.status != CodenamesGameStatus.IN_PROGRESS:
                raise GameNotInProgressError(game_id=str(game_id))

            player = get_player_from_game(game, str(user_id))

            if player.team != game.current_team:
                raise NotYourTurnError(user_id=str(user_id))
            if player.role != CodenamesRole.OPERATIVE:
                raise NotOperativeError(user_id=str(user_id))

            self._switch_turn(game)
            await game.save()

        turn_ended_payload = {
            "game_id": game.id,
            "reason": "voluntary",
            "current_team": game.current_team.value,
        }
        await self.notifier.emit_to_players("codenames_turn_ended", turn_ended_payload, game.players)

        return {
            "game_id": str(game_id),
            "current_team": game.current_team.value,
        }

    async def get_board(self, game_id: UUID, user_id: UUID, sid: str | None = None) -> dict:
        """Get the current board state for a player. Used for reconnection."""
        await cancel_disconnect_cleanup(str(user_id))

        game = await self._get_game(game_id)

        player = get_player_from_game(game, str(user_id))
        board_view = get_board_for_player(game, str(user_id))

        # Update player SID if reconnected
        if sid and player.sid != sid:
            player.sid = sid
            await game.save()

        return {
            "game_id": game.id,
            "room_id": game.room_id,
            "team": player.team.value,
            "role": player.role.value,
            "board": board_view,
            "current_team": game.current_team.value,
            "red_remaining": game.red_remaining,
            "blue_remaining": game.blue_remaining,
            "status": game.status.value,
            "current_turn": {
                "team": game.current_turn.team.value,
                "clue_word": game.current_turn.clue_word,
                "clue_number": game.current_turn.clue_number,
                "guesses_made": game.current_turn.guesses_made,
                "max_guesses": game.current_turn.max_guesses,
            }
            if game.current_turn
            else None,
            "winner": game.winner.value if game.winner else None,
            "players": [
                {
                    "user_id": str(p.user_id),
                    "username": p.username,
                    "team": p.team.value,
                    "role": p.role.value,
                }
                for p in game.players
            ],
        }

    def _switch_turn(self, game: CodenamesGame) -> None:
        """Switch the current turn to the other team."""
        next_team = CodenamesTeam.BLUE if game.current_team == CodenamesTeam.RED else CodenamesTeam.RED
        game.current_team = next_team
        game.current_turn = CodenamesTurn(team=next_team)
