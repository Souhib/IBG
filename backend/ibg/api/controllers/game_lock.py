import asyncio

_game_locks: dict[str, asyncio.Lock] = {}


def get_game_lock(game_id: str) -> asyncio.Lock:
    """Get or create an asyncio.Lock for a specific game_id."""
    if game_id not in _game_locks:
        _game_locks[game_id] = asyncio.Lock()
    return _game_locks[game_id]


def cleanup_game_lock(game_id: str) -> None:
    """Remove the lock for a game_id when the game is finished."""
    _game_locks.pop(game_id, None)
