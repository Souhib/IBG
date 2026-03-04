from typing import Any

from ibg.socketio.models.shared import IBGSocket


class NotificationService:
    """Thin wrapper around sio.emit() for socket push notifications.

    Used by game controllers to send lightweight notification events
    that trigger client-side cache invalidation via TanStack Query.
    """

    def __init__(self, sio: IBGSocket):
        self.sio = sio

    async def emit(self, event: str, data: dict[str, Any], to: str) -> None:
        """Emit an event to a specific SID."""
        await self.sio.emit(event, data, room=to)

    async def emit_to_players(self, event: str, data: dict[str, Any], players: list) -> None:
        """Emit an event to all players with valid SIDs."""
        for p in players:
            sid = getattr(p, "sid", None)
            if sid:
                await self.emit(event, data, to=sid)
