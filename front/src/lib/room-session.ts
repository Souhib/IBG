const KEY_PREFIX = "game-room:"

export function storeRoomIdForGame(gameId: string, roomId: string): void {
  try {
    sessionStorage.setItem(`${KEY_PREFIX}${gameId}`, roomId)
  } catch {
    // SessionStorage disabled or full — silent fallback
  }
}

export function retrieveRoomIdForGame(gameId: string): string | null {
  try {
    const value = sessionStorage.getItem(`${KEY_PREFIX}${gameId}`)
    if (value) sessionStorage.removeItem(`${KEY_PREFIX}${gameId}`)
    return value
  } catch {
    return null
  }
}
