from typing import Any
from uuid import UUID

from aredis_om import Field as RedisField
from pydantic import BaseModel

from ibg.socketio.models.shared import RedisJsonModel
from ibg.socketio.models.user import UndercoverSocketPlayer


class StartGame(BaseModel):
    room_id: UUID
    user_id: UUID


class SocketGameBase(BaseModel):
    room_id: UUID
    game_id: UUID
    events: list[dict[str, Any]]


# redis = get_redis_connection(port=6379)


class Game(RedisJsonModel):
    room_id: str
    id: str = RedisField(index=True)


class UndercoverTurn(BaseModel):
    votes: dict[UUID, UUID] = {}
    words: dict[UUID, str] = {}
    users_that_voted: list[UUID] = []
    eliminated_player: UUID | None = None
    description_order: list[UUID] = []
    current_describer_index: int = 0
    phase: str = "describing"


class UndercoverGame(Game, index=True):
    civilian_word: str
    undercover_word: str
    players: list[UndercoverSocketPlayer]
    eliminated_players: list[UndercoverSocketPlayer] = []
    turns: list[UndercoverTurn] = []


class StartNewTurn(BaseModel):
    room_id: UUID
    game_id: UUID


class VoteForAPerson(BaseModel):
    room_id: UUID
    game_id: UUID
    user_id: UUID
    voted_user_id: UUID


class SubmitDescription(BaseModel):
    room_id: UUID
    game_id: UUID
    user_id: UUID
    word: str
