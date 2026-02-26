import { io, type Socket } from "socket.io-client"

const WS_URL = import.meta.env.VITE_WS_URL || window.location.origin

let socket: Socket | null = null

/**
 * Get or create the Socket.IO client singleton.
 * Connects with the JWT token from localStorage for authentication.
 */
export function getSocket(): Socket {
  if (socket) return socket

  const token = localStorage.getItem("ibg-token")

  socket = io(WS_URL, {
    autoConnect: false,
    auth: token ? { token } : undefined,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  })

  // Expose for e2e testing
  ;(window as any).__SOCKET__ = socket

  return socket
}

/**
 * Connect the socket if not already connected.
 */
export function connectSocket(): void {
  const s = getSocket()
  if (!s.connected) {
    // Update auth token before connecting
    const token = localStorage.getItem("ibg-token")
    s.auth = token ? { token } : {}
    s.connect()
  }
}

/**
 * Disconnect the socket and clear the singleton.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
