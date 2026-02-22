from uuid import UUID

from aredis_om import NotFoundError
from pydantic import BaseModel

from ibg.api.constants import EVENT_UNDERCOVER_GAME_STATE
from ibg.api.models.error import GameNotFoundError, PlayerRemovedFromGameError
from ibg.api.models.undercover import UndercoverRole
from ibg.socketio.controllers.undercover_game import (
    check_if_a_team_has_win,
    create_undercover_game,
    eliminate_player_based_on_votes,
    set_vote,
    start_new_turn,
)
from ibg.socketio.models.shared import IBGSocket
from ibg.socketio.models.socket import StartGame, StartNewTurn, UndercoverGame, VoteForAPerson
from ibg.socketio.routes.shared import send_event_to_client, socketio_exception_handler


class GetUndercoverState(BaseModel):
    game_id: str
    user_id: str


def undercover_events(sio: IBGSocket) -> None:

    @sio.event
    @socketio_exception_handler(sio)
    async def start_undercover_game(sid, data) -> None:
        """Start an Undercover Game in a Room with the given data."""
        # Validation
        start_game_input = StartGame(**data)

        # Function Logic
        db_room, db_game, redis_game = await create_undercover_game(sio, start_game_input)

        # Send Notification to each player to assign role
        for player in redis_game.players:
            if player.role == UndercoverRole.MR_WHITE:
                await send_event_to_client(
                    sio,
                    "role_assigned",
                    {
                        "role": player.role.value,
                        "word": "You are Mr. White. You have to guess the word.",
                    },
                    room=player.sid,
                )
            else:
                word = (
                    redis_game.undercover_word if player.role == UndercoverRole.UNDERCOVER else redis_game.civilian_word
                )
                await send_event_to_client(
                    sio,
                    "role_assigned",
                    {
                        "role": player.role.value,
                        "word": word,
                    },
                    room=player.sid,
                )

        # Send Notification to Room that game has started
        await send_event_to_client(
            sio,
            "game_started",
            {
                "game_id": str(db_game.id),
                "game_type": "undercover",
                "message": "Undercover Game has started. Check your role and word.",
                "players": [player.username for player in redis_game.players],
                "mayor": next(player.username for player in redis_game.players if player.is_mayor),
            },
            room=str(db_room.public_id),
        )

    @sio.event
    @socketio_exception_handler(sio)
    async def start_new_turn_event(sid, data) -> None:
        """Start a new turn in the game."""
        # Validation
        start_new_turn_data = StartNewTurn(**data)

        db_room = await sio.room_controller.get_room_by_id(start_new_turn_data.room_id)
        try:
            redis_game = await UndercoverGame.get(start_new_turn_data.game_id)
        except NotFoundError:
            raise GameNotFoundError(game_id=start_new_turn_data.game_id) from None
        db_game = await sio.game_controller.get_game_by_id(redis_game.id)

        # Function Logic
        await start_new_turn(sio, db_room, db_game, redis_game)

        # Send Notification to Room that a new turn has started
        await send_event_to_client(
            sio,
            "notification",
            {"message": "Starting a new turn."},
            room=str(db_room.public_id),
        )

    @sio.event
    @socketio_exception_handler(sio)
    async def vote_for_a_player(sid, data) -> None:
        """Vote for a player in the game."""
        data = VoteForAPerson(**data)
        try:
            game = await UndercoverGame.get(data.game_id)
        except NotFoundError:
            raise GameNotFoundError(game_id=data.game_id) from None

        player_to_vote, voted_player = await set_vote(game, data)

        # Re-fetch game after vote to get latest state
        game = await UndercoverGame.get(data.game_id)

        if len(game.turns[-1].votes) == len(game.players) - len(game.eliminated_players):
            eliminated_player, number_of_vote = await eliminate_player_based_on_votes(game)

            # Send Notification to Room that a player has been eliminated
            await send_event_to_client(
                sio,
                "player_eliminated",
                {
                    "message": f"Player {eliminated_player.username} is eliminated with {number_of_vote} votes against him.",
                    "eliminated_player_role": eliminated_player.role,
                },
                room=data.room_id,
            )

            # Send Notification to the eliminated player
            await send_event_to_client(
                sio,
                "you_died",
                {"message": f"You have been eliminated with {number_of_vote} votes against you."},
                room=eliminated_player.sid,
            )
            team_that_won = await check_if_a_team_has_win(game)
            if team_that_won == UndercoverRole.CIVILIAN:
                await send_event_to_client(
                    sio,
                    "game_over",
                    {
                        "data": "The civilians have won the game.",
                    },
                    room=data.room_id,
                )
            elif team_that_won == UndercoverRole.UNDERCOVER:
                await send_event_to_client(
                    sio,
                    "game_over",
                    {
                        "data": "The undercovers have won the game.",
                    },
                    room=data.room_id,
                )

        else:
            players_that_voted = [player for player in game.players if player.user_id in game.turns[-1].votes.values()]
            await send_event_to_client(
                sio,
                "vote_casted",
                {
                    "message": "Vote casted.",
                },
                room=sid,
            )
            await send_event_to_client(
                sio,
                "waiting_other_votes",
                {
                    "message": "Waiting for other players to vote.",
                    "players_that_voted": [
                        {
                            "username": player.username,
                            "user_id": str(player.user_id),
                        }
                        for player in players_that_voted
                    ],
                },
                room=sid,
            )

    @sio.event
    @socketio_exception_handler(sio)
    async def get_undercover_state(sid, data) -> None:
        """Return full game state for a reconnecting player.

        Used when a player refreshes the page during an Undercover game
        and has no sessionStorage data.
        """
        state_data = GetUndercoverState(**data)

        try:
            game = await UndercoverGame.get(state_data.game_id)
        except NotFoundError:
            raise GameNotFoundError(game_id=state_data.game_id) from None

        # Check if the player is in the game
        player = next(
            (p for p in game.players if str(p.user_id) == state_data.user_id),
            None,
        )
        if not player:
            raise PlayerRemovedFromGameError(
                user_id=state_data.user_id,
                game_id=state_data.game_id,
            )

        # Determine word based on role
        if player.role == UndercoverRole.MR_WHITE:
            my_word = "You are Mr. White. You have to guess the word."
        elif player.role == UndercoverRole.UNDERCOVER:
            my_word = game.undercover_word
        else:
            my_word = game.civilian_word

        # Build voted info
        current_turn_votes = {}
        has_voted = False
        if game.turns:
            current_turn = game.turns[-1]
            current_turn_votes = {str(voter_id): str(voted_id) for voter_id, voted_id in current_turn.votes.items()}
            has_voted = UUID(state_data.user_id) in current_turn.votes

        await send_event_to_client(
            sio,
            EVENT_UNDERCOVER_GAME_STATE,
            {
                "game_id": game.id,
                "room_id": game.room_id,
                "my_role": player.role.value,
                "my_word": my_word,
                "is_alive": player.is_alive,
                "players": [
                    {
                        "user_id": str(p.user_id),
                        "username": p.username,
                        "is_alive": p.is_alive,
                        "is_mayor": p.is_mayor,
                    }
                    for p in game.players
                ],
                "eliminated_players": [
                    {
                        "user_id": str(p.user_id),
                        "username": p.username,
                        "role": p.role.value,
                    }
                    for p in game.eliminated_players
                ],
                "turn_number": len(game.turns),
                "votes": current_turn_votes,
                "has_voted": has_voted,
            },
            room=sid,
        )
