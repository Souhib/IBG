import random
from uuid import UUID

from aredis_om import NotFoundError
from sqlmodel.ext.asyncio.session import AsyncSession

from ibg.api.controllers.game import GameController
from ibg.api.controllers.notification import NotificationService
from ibg.api.controllers.room import RoomController
from ibg.api.controllers.undercover import UndercoverController
from ibg.api.models.error import (
    CantVoteBecauseYouDeadError,
    CantVoteForDeadPersonError,
    CantVoteForYourselfError,
    GameNotFoundError,
    PlayerRemovedFromGameError,
    RoomNotFoundError,
)
from ibg.api.models.event import EventCreate
from ibg.api.models.game import GameCreate, GameType
from ibg.api.models.undercover import UndercoverRole, Word
from ibg.api.schemas.error import BaseError
from ibg.socketio.models.room import Room as RedisRoom
from ibg.socketio.models.shared import redis_connection
from ibg.socketio.models.socket import UndercoverGame, UndercoverTurn
from ibg.socketio.models.user import UndercoverSocketPlayer
from ibg.socketio.models.user import User as RedisUser
from ibg.socketio.utils.disconnect_tasks import cancel_disconnect_cleanup
from ibg.socketio.utils.redis_ttl import set_game_finished_ttl


class UndercoverGameController:
    """REST-callable controller for Undercover game logic.

    Extracted from ibg/socketio/controllers/undercover_game.py.
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
        self._undercover_controller = UndercoverController(session)

    async def _get_civilian_and_undercover_words(self) -> tuple[Word, Word]:
        """Get the civilian and undercover words for the game."""
        term_pair = await self._undercover_controller.get_random_term_pair()
        civilian_word_id = term_pair.word1_id
        undercover_word_id = term_pair.word2_id
        if random.choice([True, False]):
            civilian_word_id, undercover_word_id = term_pair.word2_id, term_pair.word1_id
        civilian_word = await self._undercover_controller.get_word_by_id(civilian_word_id)
        undercover_word = await self._undercover_controller.get_word_by_id(undercover_word_id)
        return civilian_word, undercover_word

    def _generate_description_order(self, players: list[UndercoverSocketPlayer]) -> list[UUID]:
        """Generate a randomized description order for alive players.

        Mr. White is never placed first. If Mr. White ends up at index 0,
        swap with a random other player.
        """
        alive_ids = [p.user_id for p in players if p.is_alive]
        random.shuffle(alive_ids)

        if len(alive_ids) > 1:
            mr_white_ids = {p.user_id for p in players if p.role == UndercoverRole.MR_WHITE and p.is_alive}
            if alive_ids[0] in mr_white_ids:
                swap_candidates = [i for i in range(1, len(alive_ids)) if alive_ids[i] not in mr_white_ids]
                if swap_candidates:
                    swap_idx = random.choice(swap_candidates)
                    alive_ids[0], alive_ids[swap_idx] = alive_ids[swap_idx], alive_ids[0]

        return alive_ids

    async def create_and_start(self, room_id: UUID, user_id: UUID) -> dict:
        """Start a new Undercover game in the given room.

        Creates game in DB and Redis, assigns roles, starts first turn,
        and notifies all players.
        """
        db_room = await self._room_controller.get_room_by_id(room_id)
        async with redis_connection.lock(f"room:{db_room.id}:start", timeout=10):
            async with redis_connection.lock(f"room:{db_room.id}:join", timeout=5):
                try:
                    room = await RedisRoom.get(str(db_room.id))
                except NotFoundError:
                    raise RoomNotFoundError(room_id=room_id) from None

                if room.active_game_id:
                    raise BaseError(
                        message=f"Room {room_id} already has an active game",
                        frontend_message="A game is already in progress.",
                        status_code=400,
                    )

                players = room.users
            num_players = len(players)
            if num_players == 3:
                num_mr_white = 0
                num_undercover = 1
                num_civilians = 2
            else:
                num_mr_white = 1 if num_players < 10 else (2 if num_players <= 15 else 3)
                num_undercover = max(2, num_players // 4)
                num_civilians = num_players - num_mr_white - num_undercover
                while num_civilians < 1 and num_undercover > 1:
                    num_undercover -= 1
                    num_civilians += 1
                while num_civilians < 1 and num_mr_white > 0:
                    num_mr_white -= 1
                    num_civilians += 1
            roles = (
                [UndercoverRole.UNDERCOVER] * num_undercover
                + [UndercoverRole.CIVILIAN] * num_civilians
                + [UndercoverRole.MR_WHITE] * num_mr_white
            )
            random.shuffle(roles)
            undercover_players = [
                UndercoverSocketPlayer(user_id=player.id, username=player.username, role=role, sid=player.sid)
                for player, role in zip(players, roles, strict=True)
            ]
            undercover_players[random.randint(0, len(undercover_players) - 1)].is_mayor = True
            civilian_word, undercover_word = await self._get_civilian_and_undercover_words()
            db_game = await self._game_controller.create_game(
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

            room.active_game_id = str(db_game.id)
            room.active_game_type = "undercover"
            await room.save()

        # Start first turn
        await self._start_new_turn(db_room, db_game, redis_game)

        # Notify each player with their role
        for player in redis_game.players:
            if player.role == UndercoverRole.MR_WHITE:
                word = "You are Mr. White. You have to guess the word."
            elif player.role == UndercoverRole.UNDERCOVER:
                word = redis_game.undercover_word
            else:
                word = redis_game.civilian_word

            if player.sid:
                await self.notifier.emit("role_assigned", {"role": player.role.value, "word": word}, to=player.sid)

        # Notify game started
        game_started_payload = {
            "game_id": str(db_game.id),
            "game_type": "undercover",
            "message": "Undercover Game has started. Check your role and word.",
            "players": [player.username for player in redis_game.players],
            "mayor": next(player.username for player in redis_game.players if player.is_mayor),
        }
        await self.notifier.emit_to_players("game_started", game_started_payload, redis_game.players)

        return {
            "game_id": str(db_game.id),
            "room_id": str(db_room.id),
        }

    async def _start_new_turn(self, db_room, db_game, redis_game: UndercoverGame) -> None:
        """Start a new turn in the game."""
        turn = await self._game_controller.create_turn(game_id=db_game.id)
        await self._game_controller.create_turn_event(
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
        description_order = self._generate_description_order(redis_game.players)
        new_turn = UndercoverTurn(
            description_order=description_order,
            current_describer_index=0,
            phase="describing",
        )
        redis_game.turns.append(new_turn)
        await redis_game.save()

    async def start_next_round(self, game_id: UUID, room_id: UUID, user_id: UUID) -> dict:
        """Start a new round (turn) in an existing game."""
        db_room = await self._room_controller.get_room_by_id(room_id)

        async with redis_connection.lock(f"game:{game_id}:state", timeout=30):
            redis_game = await self._get_game(game_id)
            db_game = await self._game_controller.get_game_by_id(UUID(redis_game.id))
            await self._start_new_turn(db_room, db_game, redis_game)

            # Re-fetch game to get updated turn state
            redis_game = await UndercoverGame.get(str(game_id))
            current_turn = redis_game.turns[-1]

            description_order_with_names = []
            for uid in current_turn.description_order:
                p = next((p for p in redis_game.players if p.user_id == uid), None)
                if p:
                    description_order_with_names.append({"user_id": str(uid), "username": p.username})

            first_describer_id = str(current_turn.description_order[0]) if current_turn.description_order else None

        # Emit AFTER releasing the lock — re-read for fresh SIDs
        redis_game = await UndercoverGame.get(str(game_id))

        turn_started_payload = {
            "message": "Starting a new turn.",
            "description_order": description_order_with_names,
            "current_describer_index": 0,
            "phase": "describing",
        }
        await self.notifier.emit_to_players("turn_started", turn_started_payload, redis_game.players)

        # Notify the first describer
        if first_describer_id:
            first_player = next((p for p in redis_game.players if str(p.user_id) == first_describer_id), None)
            if first_player and first_player.sid:
                await self.notifier.emit(
                    "your_turn_to_describe", {"user_id": first_describer_id}, to=first_player.sid
                )

        return {
            "game_id": str(game_id),
            "turn_number": len(redis_game.turns),
            "description_order": description_order_with_names,
        }

    async def submit_description(self, game_id: UUID, user_id: UUID, word: str) -> dict:
        """Submit a single-word description for the current turn."""
        async with redis_connection.lock(f"game:{game_id}:state", timeout=5):
            game = await self._get_game(game_id)

            current_turn = game.turns[-1]

            if current_turn.phase != "describing":
                raise BaseError(
                    message="Not in description phase.",
                    frontend_message="Not in description phase.",
                    status_code=400,
                )

            if current_turn.current_describer_index >= len(current_turn.description_order):
                raise BaseError(
                    message="All descriptions already submitted.",
                    frontend_message="All descriptions already submitted.",
                    status_code=400,
                )
            if current_turn.description_order[current_turn.current_describer_index] != user_id:
                raise BaseError(
                    message="Not your turn to describe.",
                    frontend_message="Not your turn to describe.",
                    status_code=400,
                )

            # Validate word
            word = word.strip()
            if not word or " " in word or len(word) > 50:
                raise BaseError(
                    message="Word must be a single word (no spaces), max 50 characters.",
                    frontend_message="Word must be a single word (no spaces), max 50 characters.",
                    status_code=400,
                )

            # Store description and advance index
            current_turn.words[user_id] = word
            current_turn.current_describer_index += 1
            all_done = current_turn.current_describer_index >= len(current_turn.description_order)
            await game.save()

            submitter = next((p for p in game.players if p.user_id == user_id), None)
            submitter_username = submitter.username if submitter else "Unknown"
            next_describer_id, next_describer_username = self._get_next_describer(game, current_turn, all_done)

            desc_payload = {
                "user_id": str(user_id),
                "username": submitter_username,
                "word": word,
                "next_describer_id": next_describer_id,
                "next_describer_username": next_describer_username,
            }
            await self.notifier.emit_to_players("description_submitted", desc_payload, game.players)
            await self._handle_description_phase_transition(game, current_turn, all_done, next_describer_id)

        return {
            "game_id": str(game_id),
            "all_described": all_done,
            "word": word,
        }

    def _get_next_describer(
        self, game: UndercoverGame, current_turn: UndercoverTurn, all_done: bool
    ) -> tuple[str | None, str | None]:
        """Get the next describer's ID and username, or (None, None) if all done."""
        if all_done:
            return None, None
        next_idx = current_turn.current_describer_index
        if next_idx < len(current_turn.description_order):
            next_uid = current_turn.description_order[next_idx]
            next_player = next((p for p in game.players if p.user_id == next_uid), None)
            return str(next_uid), (next_player.username if next_player else None)
        return None, None

    async def _handle_description_phase_transition(
        self, game: UndercoverGame, current_turn: UndercoverTurn, all_done: bool, next_describer_id: str | None
    ) -> None:
        """Handle phase transition after a description is submitted."""
        if all_done:
            current_turn.phase = "voting"
            await game.save()
            descriptions = {str(uid): w for uid, w in current_turn.words.items()}
            await self.notifier.emit_to_players("descriptions_complete", {"descriptions": descriptions}, game.players)
        elif next_describer_id:
            next_player = next((p for p in game.players if str(p.user_id) == next_describer_id), None)
            if next_player and next_player.sid:
                await self.notifier.emit(
                    "your_turn_to_describe", {"user_id": next_describer_id}, to=next_player.sid
                )

    async def submit_vote(self, game_id: UUID, user_id: UUID, voted_for: UUID) -> dict:
        """Submit a vote for a player."""
        async with redis_connection.lock(f"game:{game_id}:state", timeout=10):
            game = await self._get_game(game_id)

            # Block voting during description phase
            if game.turns and game.turns[-1].phase != "voting":
                raise BaseError(
                    message="Descriptions are not complete yet.",
                    frontend_message="Descriptions are not complete yet.",
                    status_code=400,
                )

            # Validate vote
            player_to_vote = next((p for p in game.players if p.user_id == user_id), None)
            if not player_to_vote:
                raise BaseError(message="Player not in game.", frontend_message="Player not in game.", status_code=400)
            if not player_to_vote.is_alive:
                raise CantVoteBecauseYouDeadError(user_id=user_id)
            voted_player = next((p for p in game.players if p.user_id == voted_for), None)
            if not voted_player:
                raise BaseError(
                    message="Voted player not in game.", frontend_message="Voted player not in game.", status_code=400
                )
            if not voted_player.is_alive:
                raise CantVoteForDeadPersonError(user_id=user_id, dead_user_id=voted_for)
            if player_to_vote.user_id == voted_player.user_id:
                raise CantVoteForYourselfError(user_id=user_id)

            game.turns[-1].votes[user_id] = voted_player.user_id
            await game.save()

            alive_count = sum(1 for p in game.players if p.is_alive)
            all_voted = len(game.turns[-1].votes) == alive_count

            result: dict = {"game_id": str(game_id), "all_voted": all_voted}

            if all_voted:
                result = await self._handle_all_voted(game, result)
            else:
                await self._notify_vote_pending(game, user_id)

        return result

    async def _handle_all_voted(self, game: UndercoverGame, result: dict) -> dict:
        """Handle the case when all alive players have voted."""
        eliminated_player, number_of_votes = await self._eliminate_player_based_on_votes(game)

        elimination_payload = {
            "message": f"Player {eliminated_player.username} is eliminated with {number_of_votes} votes against him.",
            "eliminated_player_role": eliminated_player.role.value,
            "eliminated_player_username": eliminated_player.username,
            "eliminated_player_user_id": str(eliminated_player.user_id),
        }
        await self.notifier.emit_to_players("player_eliminated", elimination_payload, game.players)

        if eliminated_player.sid:
            await self.notifier.emit(
                "you_died",
                {"message": f"You have been eliminated with {number_of_votes} votes against you."},
                to=eliminated_player.sid,
            )

        team_that_won = await self._check_if_a_team_has_win(game)
        game_over_payload = None
        if team_that_won == UndercoverRole.CIVILIAN:
            game_over_payload = {"data": "The civilians have won the game.", "winner": "civilians"}
        elif team_that_won == UndercoverRole.UNDERCOVER:
            game_over_payload = {"data": "The undercovers have won the game.", "winner": "undercovers"}

        if game_over_payload:
            await self.notifier.emit_to_players("game_over", game_over_payload, game.players)

        result["eliminated_player"] = str(eliminated_player.user_id)
        result["winner"] = game_over_payload["winner"] if game_over_payload else None
        return result

    async def _notify_vote_pending(self, game: UndercoverGame, user_id: UUID) -> None:
        """Notify the voter that their vote was recorded and they're waiting for others."""
        players_that_voted = [p for p in game.players if p.user_id in game.turns[-1].votes]
        voter = next((p for p in game.players if p.user_id == user_id), None)
        if voter and voter.sid:
            await self.notifier.emit("vote_casted", {"message": "Vote casted."}, to=voter.sid)
            await self.notifier.emit(
                "waiting_other_votes",
                {
                    "message": "Waiting for other players to vote.",
                    "players_that_voted": [
                        {"username": p.username, "user_id": str(p.user_id)} for p in players_that_voted
                    ],
                },
                to=voter.sid,
            )

    async def _eliminate_player_based_on_votes(
        self, game: UndercoverGame
    ) -> tuple[UndercoverSocketPlayer, int]:
        """Eliminate the player with the most votes."""
        votes = game.turns[-1].votes
        vote_counts: dict[UUID, int] = {player.user_id: 0 for player in game.players}
        for voted_id in votes.values():
            vote_counts[voted_id] += 1

        max_votes = max(vote_counts.values())
        players_with_max_votes = [pid for pid, count in vote_counts.items() if count == max_votes]

        if len(players_with_max_votes) > 1:
            mayor_vote = next(
                (votes.get(p.user_id) for p in game.players if p.is_mayor),
                None,
            )
            player_with_most_vote = (
                mayor_vote if mayor_vote in players_with_max_votes else players_with_max_votes[0]
            )
        else:
            player_with_most_vote = players_with_max_votes[0]

        eliminated_player = next(p for p in game.players if p.user_id == player_with_most_vote)
        eliminated_player.is_alive = False
        game.eliminated_players.append(eliminated_player)
        await game.save()

        return eliminated_player, vote_counts[player_with_most_vote]

    def _get_winning_team(self, game: UndercoverGame) -> UndercoverRole | None:
        """Determine if a team has won based on alive player counts."""
        num_alive_undercover = sum(1 for p in game.players if p.role == UndercoverRole.UNDERCOVER and p.is_alive)
        num_alive_civilian = sum(1 for p in game.players if p.role == UndercoverRole.CIVILIAN and p.is_alive)
        num_alive_mr_white = sum(1 for p in game.players if p.role == UndercoverRole.MR_WHITE and p.is_alive)
        total_mr_white = sum(1 for p in game.players if p.role == UndercoverRole.MR_WHITE)

        if num_alive_undercover == 0 and num_alive_mr_white == 0:
            return UndercoverRole.CIVILIAN
        if num_alive_civilian == 0:
            return UndercoverRole.UNDERCOVER
        if total_mr_white > 0 and num_alive_mr_white == 0:
            return UndercoverRole.UNDERCOVER
        return None

    async def _check_if_a_team_has_win(self, game: UndercoverGame) -> UndercoverRole | None:
        """Check if a team has won and clear active game if so."""
        winner = self._get_winning_team(game)

        if winner:
            await set_game_finished_ttl(game)
            try:
                redis_room = await RedisRoom.get(game.room_id)
                redis_room.active_game_id = None
                redis_room.active_game_type = None
                await redis_room.save()
            except NotFoundError:
                pass

        return winner

    async def get_state(self, game_id: UUID, user_id: UUID, sid: str | None = None) -> dict:
        """Get full game state for a player. Used for reconnection and initial page load."""
        await self._handle_reconnection(user_id, game_id, sid)

        game = await self._get_game(game_id)
        player = next((p for p in game.players if p.user_id == user_id), None)
        if not player:
            raise PlayerRemovedFromGameError(user_id=str(user_id), game_id=str(game_id))

        my_word = self._get_player_word(player, game)
        turn_state = self._build_turn_state(game, user_id)
        winner = self._get_winner_label(game)
        is_host = await self._check_is_host(game.room_id, user_id)

        return {
            "game_id": game.id,
            "room_id": game.room_id,
            "is_host": is_host,
            "my_role": player.role.value,
            "my_word": my_word,
            "is_alive": player.is_alive,
            "players": [
                {"user_id": str(p.user_id), "username": p.username, "is_alive": p.is_alive, "is_mayor": p.is_mayor}
                for p in game.players
            ],
            "eliminated_players": [
                {"user_id": str(p.user_id), "username": p.username, "role": p.role.value}
                for p in game.eliminated_players
            ],
            "turn_number": len(game.turns),
            "winner": winner,
            **turn_state,
        }

    async def _get_game(self, game_id: UUID) -> UndercoverGame:
        """Fetch an UndercoverGame from Redis or raise GameNotFoundError."""
        try:
            return await UndercoverGame.get(str(game_id))
        except NotFoundError:
            raise GameNotFoundError(game_id=game_id) from None

    async def _handle_reconnection(self, user_id: UUID, game_id: UUID, sid: str | None) -> None:
        """Handle player reconnection: cancel cleanup, clear disconnect flag, update SID."""
        await cancel_disconnect_cleanup(str(user_id))

        try:
            redis_user = await RedisUser.get(str(user_id))
            if redis_user.disconnected_at is not None:
                redis_user.disconnected_at = None
                await redis_user.save()
        except NotFoundError:
            pass

        if sid:
            async with redis_connection.lock(f"game:{game_id}:state", timeout=5):
                game = await UndercoverGame.get(str(game_id))
                player = next((p for p in game.players if p.user_id == user_id), None)
                if player and player.sid != sid:
                    player.sid = sid
                    await game.save()

    def _get_player_word(self, player: UndercoverSocketPlayer, game: UndercoverGame) -> str:
        """Get the word to display for a player based on their role."""
        if player.role == UndercoverRole.MR_WHITE:
            return "You are Mr. White. You have to guess the word."
        if player.role == UndercoverRole.UNDERCOVER:
            return game.undercover_word
        return game.civilian_word

    def _build_turn_state(self, game: UndercoverGame, user_id: UUID) -> dict:
        """Build the turn-specific state dict."""
        if not game.turns:
            return {
                "votes": {},
                "has_voted": False,
                "turn_phase": "describing",
                "description_order": [],
                "current_describer_index": 0,
                "descriptions": {},
            }
        current_turn = game.turns[-1]
        return {
            "votes": {str(voter_id): str(voted_id) for voter_id, voted_id in current_turn.votes.items()},
            "has_voted": user_id in current_turn.votes,
            "turn_phase": current_turn.phase,
            "description_order": [
                {"user_id": str(uid), "username": next((p.username for p in game.players if p.user_id == uid), "Unknown")}
                for uid in current_turn.description_order
            ],
            "current_describer_index": current_turn.current_describer_index,
            "descriptions": {str(uid): w for uid, w in current_turn.words.items()},
        }

    def _get_winner_label(self, game: UndercoverGame) -> str | None:
        """Get the winner label string, or None if game is still in progress."""
        winning_team = self._get_winning_team(game)
        if winning_team == UndercoverRole.CIVILIAN:
            return "civilians"
        if winning_team == UndercoverRole.UNDERCOVER:
            return "undercovers"
        return None

    async def _check_is_host(self, room_id: str, user_id: UUID) -> bool:
        """Check if the user is the host of the room."""
        try:
            redis_room = await RedisRoom.get(room_id)
            return redis_room.owner_id == str(user_id)
        except NotFoundError:
            return False
