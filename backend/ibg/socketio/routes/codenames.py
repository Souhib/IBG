from loguru import logger

from ibg.api.constants import (
    EVENT_CODENAMES_CARD_REVEALED,
    EVENT_CODENAMES_CLUE_GIVEN,
    EVENT_CODENAMES_GAME_OVER,
    EVENT_CODENAMES_GAME_STARTED,
    EVENT_CODENAMES_TURN_ENDED,
)
from ibg.socketio.controllers.codenames import (
    end_turn as controller_end_turn,
)
from ibg.socketio.utils.disconnect_tasks import cancel_disconnect_cleanup
from ibg.socketio.controllers.codenames import (
    get_board_for_player,
    get_codenames_game,
    get_player_from_game,
)
from ibg.socketio.controllers.codenames import (
    give_clue as controller_give_clue,
)
from ibg.socketio.controllers.codenames import (
    guess_card as controller_guess_card,
)
from ibg.socketio.controllers.codenames import (
    start_codenames_game as controller_start_game,
)
from ibg.socketio.models.codenames import (
    CodenamesGameStatus,
    EndTurn,
    GetBoard,
    GiveClue,
    GuessCard,
    StartCodenamesGame,
)
from ibg.socketio.models.shared import IBGSocket
from ibg.socketio.routes.shared import send_event_to_client, socketio_exception_handler


def codenames_events(sio: IBGSocket) -> None:

    async def _get_sio_room(game) -> str:
        """Get the SIO room name (public_id) for broadcasting game events."""
        db_room = await sio.room_controller.get_room_by_id(game.room_id)
        return str(db_room.public_id)

    @sio.event
    @socketio_exception_handler(sio)
    async def start_codenames_game(sid, data) -> None:
        """Start a Codenames game in the room.

        :param sid: The socket id of the user.
        :param data: Should match the StartCodenamesGame model.
        """
        # Validation
        start_game_input = StartCodenamesGame(**data)

        # Function Logic
        redis_game = await controller_start_game(
            sio=sio,
            room_id=start_game_input.room_id,
            user_id=start_game_input.user_id,
            word_pack_ids=start_game_input.word_pack_ids,
        )

        # Send role assignments to each player individually
        for player in redis_game.players:
            board_view = get_board_for_player(redis_game, str(player.user_id))
            await send_event_to_client(
                sio,
                EVENT_CODENAMES_GAME_STARTED,
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
                room=player.sid,
            )

    @sio.event
    @socketio_exception_handler(sio)
    async def give_clue(sid, data) -> None:
        """Spymaster gives a clue to their team.

        :param sid: The socket id of the user.
        :param data: Should match the GiveClue model.
        """
        # Validation
        clue_data = GiveClue(**data)

        # Function Logic
        game = await controller_give_clue(
            game_id=clue_data.game_id,
            user_id=clue_data.user_id,
            clue_word=clue_data.clue_word,
            clue_number=clue_data.clue_number,
        )

        # Update acting player's SID
        player = get_player_from_game(game, clue_data.user_id)
        if player and player.sid != sid:
            player.sid = sid
            await game.save()

        # Ensure sender is in the SIO room, then broadcast
        sio_room = await _get_sio_room(game)
        logger.info(f"[give_clue] sid={sid} room={sio_room} clue={clue_data.clue_word}")
        sio.enter_room(sid, sio_room)
        await send_event_to_client(
            sio,
            EVENT_CODENAMES_CLUE_GIVEN,
            {
                "game_id": game.id,
                "team": game.current_team.value,
                "clue_word": clue_data.clue_word,
                "clue_number": clue_data.clue_number,
                "max_guesses": game.current_turn.max_guesses,
            },
            room=sio_room,
        )

    @sio.event
    @socketio_exception_handler(sio)
    async def guess_card(sid, data) -> None:
        """Operative guesses a card on the board.

        :param sid: The socket id of the user.
        :param data: Should match the GuessCard model.
        """
        # Validation
        guess_data = GuessCard(**data)

        # Function Logic
        game, revealed_card, result = await controller_guess_card(
            game_id=guess_data.game_id,
            user_id=guess_data.user_id,
            card_index=guess_data.card_index,
        )

        # Update acting player's SID and ensure they're in the SIO room
        acting_player = get_player_from_game(game, guess_data.user_id)
        if acting_player and acting_player.sid != sid:
            acting_player.sid = sid
            await game.save()
        sio_room = await _get_sio_room(game)
        sio.enter_room(sid, sio_room)

        # Send card revealed event to all players (role-specific board view)
        for player in game.players:
            board_view = get_board_for_player(game, str(player.user_id))
            await send_event_to_client(
                sio,
                EVENT_CODENAMES_CARD_REVEALED,
                {
                    "game_id": game.id,
                    "card_index": guess_data.card_index,
                    "card_word": revealed_card.word,
                    "card_type": revealed_card.card_type.value,
                    "result": result,
                    "current_team": game.current_team.value,
                    "red_remaining": game.red_remaining,
                    "blue_remaining": game.blue_remaining,
                    "guesses_made": game.current_turn.guesses_made if game.current_turn else 0,
                    "max_guesses": game.current_turn.max_guesses if game.current_turn else 0,
                    "board": board_view,
                },
                room=player.sid,
            )

        # If the game is over, broadcast game over to SIO room
        if game.status == CodenamesGameStatus.FINISHED:
            full_board = [
                {
                    "index": i,
                    "word": card.word,
                    "card_type": card.card_type.value,
                    "revealed": card.revealed,
                }
                for i, card in enumerate(game.board)
            ]
            await send_event_to_client(
                sio,
                EVENT_CODENAMES_GAME_OVER,
                {
                    "game_id": game.id,
                    "winner": game.winner.value if game.winner else None,
                    "reason": result,
                    "board": full_board,
                },
                room=sio_room,
            )

        # If turn ended (not game over), broadcast to SIO room
        elif result in ("opponent_card", "neutral", "max_guesses"):
            await send_event_to_client(
                sio,
                EVENT_CODENAMES_TURN_ENDED,
                {
                    "game_id": game.id,
                    "reason": result,
                    "current_team": game.current_team.value,
                },
                room=sio_room,
            )

    @sio.event
    @socketio_exception_handler(sio)
    async def end_turn(sid, data) -> None:
        """Operative voluntarily ends their team's turn.

        :param sid: The socket id of the user.
        :param data: Should match the EndTurn model.
        """
        # Validation
        end_turn_data = EndTurn(**data)

        # Function Logic
        game = await controller_end_turn(
            game_id=end_turn_data.game_id,
            user_id=end_turn_data.user_id,
        )

        # Update acting player's SID and ensure they're in the SIO room
        acting_player = get_player_from_game(game, end_turn_data.user_id)
        if acting_player and acting_player.sid != sid:
            acting_player.sid = sid
            await game.save()
        sio_room = await _get_sio_room(game)
        sio.enter_room(sid, sio_room)

        await send_event_to_client(
            sio,
            EVENT_CODENAMES_TURN_ENDED,
            {
                "game_id": game.id,
                "reason": "voluntary",
                "current_team": game.current_team.value,
            },
            room=sio_room,
        )

    @sio.event
    @socketio_exception_handler(sio)
    async def get_board(sid, data) -> None:
        """Get the current board state for a player.

        :param sid: The socket id of the user.
        :param data: Should match the GetBoard model.
        """
        # Validation
        board_data = GetBoard(**data)

        # Cancel any pending disconnect cleanup (player reconnecting via page reload)
        cancel_disconnect_cleanup(board_data.user_id)

        # Function Logic
        game = await get_codenames_game(board_data.game_id)
        board_view = get_board_for_player(game, board_data.user_id)

        # Find the requesting player to include their team/role
        player = get_player_from_game(game, board_data.user_id)

        # Update player SID if reconnected with a new socket
        if player.sid != sid:
            player.sid = sid
            await game.save()

        # Ensure the (possibly reconnected) socket is in the correct SIO room
        try:
            db_room = await sio.room_controller.get_room_by_id(game.room_id)
            sio.enter_room(sid, str(db_room.public_id))
        except Exception:
            pass  # Best-effort room rejoin

        # Send board state to the requesting player
        await send_event_to_client(
            sio,
            "codenames_board",
            {
                "game_id": game.id,
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
                } if game.current_turn else None,
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
            },
            room=sid,
        )
