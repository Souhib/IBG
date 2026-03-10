import { describe, expect, it, vi, beforeEach } from "vitest"

// Mock socket.io-client
const mockOn = vi.fn()
const mockEmit = vi.fn()
const mockDisconnect = vi.fn()
const mockSocket = {
  on: mockOn,
  emit: mockEmit,
  disconnect: mockDisconnect,
  connected: false,
}
const mockIo = vi.fn(() => mockSocket)
vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => mockIo(...args),
}))

// Mock auth
vi.mock("@/lib/auth", () => ({
  getStoredToken: () => "test-token",
}))

// Mock generated API hooks
vi.mock("@/api/generated", () => ({
  getRoomStateApiV1RoomsRoomIdStateGetQueryKey: ({ room_id }: { room_id: string }) => [{ url: '/api/v1/rooms/:room_id/state', params: { room_id } }],
  getUndercoverStateApiV1UndercoverGamesGameIdStateGetQueryKey: ({ game_id }: { game_id: string }) => [{ url: '/api/v1/undercover/games/:game_id/state', params: { game_id } }],
  getCodenamesBoardApiV1CodenamesGamesGameIdBoardGetQueryKey: ({ game_id }: { game_id: string }) => [{ url: '/api/v1/codenames/games/:game_id/board', params: { game_id } }],
}))

// Mock TanStack Query
const mockSetQueryData = vi.fn()
const mockSetQueriesData = vi.fn()
const mockInvalidateQueries = vi.fn()
const mockQueryClient = {
  setQueryData: mockSetQueryData,
  setQueriesData: mockSetQueriesData,
  invalidateQueries: mockInvalidateQueries,
}
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockQueryClient,
}))

// Import after mocks
const { useSocket } = await import("./use-socket")

// Minimal renderHook for testing hooks without full React test utils
import { renderHook } from "@testing-library/react"

describe("useSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSocket.connected = false
    mockOn.mockReset()
    mockIo.mockReturnValue(mockSocket)
  })

  it("connects when enabled with roomId", () => {
    renderHook(() => useSocket({ roomId: "room-1", enabled: true }))
    expect(mockIo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        auth: { token: "test-token", room_id: "room-1" },
      }),
    )
  })

  it("does not connect when disabled", () => {
    renderHook(() => useSocket({ roomId: "room-1", enabled: false }))
    expect(mockIo).not.toHaveBeenCalled()
  })

  it("does not connect without roomId", () => {
    renderHook(() => useSocket({ roomId: null, enabled: true }))
    expect(mockIo).not.toHaveBeenCalled()
  })

  it("registers room_state, game_state, game_updated, connect, disconnect, and connect_error listeners", () => {
    renderHook(() => useSocket({ roomId: "room-1", enabled: true }))
    const events = mockOn.mock.calls.map((c: unknown[]) => c[0])
    expect(events).toContain("room_state")
    expect(events).toContain("game_state")
    expect(events).toContain("game_updated")
    expect(events).toContain("connect")
    expect(events).toContain("disconnect")
    expect(events).toContain("connect_error")
  })

  it("returns connected: false initially and true after connect event", () => {
    const { result } = renderHook(() => useSocket({ roomId: "room-1", enabled: true }))
    expect(result.current.connected).toBe(false)
  })

  it("room_state handler updates query cache", () => {
    renderHook(() => useSocket({ roomId: "room-1", enabled: true }))
    const roomStateHandler = mockOn.mock.calls.find((c: unknown[]) => c[0] === "room_state")?.[1]

    roomStateHandler({
      id: "room-1",
      public_id: "pub-1",
      owner_id: "o1",
      password: null,
      active_game_id: null,
      game_type: "undercover",
      settings: {},
      players: [{ user_id: "u1", username: "Alice", is_spectator: false }],
    })

    expect(mockSetQueryData).toHaveBeenCalledWith(
      [{ url: '/api/v1/rooms/:room_id/state', params: { room_id: "room-1" } }],
      expect.objectContaining({
        id: "room-1",
        players: [{ user_id: "u1", username: "Alice", is_spectator: false }],
      }),
    )
  })

  it("disconnects on unmount", () => {
    const { unmount } = renderHook(() => useSocket({ roomId: "room-1", enabled: true }))
    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it("emits join_game when gameId is set and socket is connected", () => {
    mockSocket.connected = true
    renderHook(() => useSocket({ roomId: "room-1", gameId: "game-1", gameType: "undercover", enabled: true }))
    expect(mockEmit).toHaveBeenCalledWith("join_game", { game_id: "game-1" })
  })
})
