from uuid import UUID

from aredis_om import Field as RedisField
from pydantic import BaseModel

from ibg.api.models.undercover import CodeNameTeam, UndercoverRole
from ibg.socketio.models.shared import RedisJsonModel


class User(RedisJsonModel, index=True):
    id: str = RedisField(index=True)
    username: str = RedisField(index=True)
    sid: str = RedisField(index=True)
    room_id: str | None = None
    disconnected_at: float | None = None


class SocketPlayer(BaseModel):
    sid: str
    user_id: UUID
    username: str


class UndercoverSocketPlayer(SocketPlayer):
    role: UndercoverRole
    is_alive: bool = True
    is_mayor: bool = False


class CodeNamesSocketPlayer(SocketPlayer):
    team: CodeNameTeam
    is_alive: bool = True
