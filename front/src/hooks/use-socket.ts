import { useCallback, useEffect, useRef, useState } from "react"
import type { Socket } from "socket.io-client"
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket"
import { useAuth } from "@/providers/AuthProvider"

/**
 * Hook to manage Socket.IO connection with authentication.
 * Automatically connects when authenticated and disconnects on logout.
 * Queues emit calls when disconnected and flushes on reconnect.
 */
export function useSocket() {
  const { isAuthenticated, token } = useAuth()
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const pendingEmits = useRef<Array<{ event: string; data: unknown }>>([])

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket()
      setIsConnected(false)
      setConnectionError(null)
      socketRef.current = null
      pendingEmits.current = []
      return
    }

    const socket = getSocket()
    socketRef.current = socket

    const onConnect = () => {
      setIsConnected(true)
      setConnectionError(null)
    }
    const onDisconnect = () => {
      setIsConnected(false)
    }
    const onConnectError = (err: Error) => {
      setConnectionError(err.message)
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.on("connect_error", onConnectError)

    // If already connected (singleton from previous page), update state immediately
    if (socket.connected) {
      setIsConnected(true)
    }

    connectSocket()

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.off("connect_error", onConnectError)
    }
  }, [isAuthenticated])

  // Update socket auth token when it changes (e.g. after refresh)
  useEffect(() => {
    if (socketRef.current && token) {
      socketRef.current.auth = { token }
    }
  }, [token])

  // Flush queued emits on reconnect
  useEffect(() => {
    if (!isConnected || pendingEmits.current.length === 0) return
    const queue = [...pendingEmits.current]
    pendingEmits.current = []
    for (const item of queue) {
      socketRef.current?.emit(item.event, item.data)
    }
  }, [isConnected])

  const emit = useCallback(
    (event: string, data?: unknown) => {
      const socket = socketRef.current
      if (socket?.connected) {
        socket.emit(event, data)
      } else {
        pendingEmits.current.push({ event, data: data ?? null })
      }
    },
    [],
  )

  const on = useCallback(
    (event: string, handler: (...args: unknown[]) => void) => {
      socketRef.current?.on(event, handler)
      return () => {
        socketRef.current?.off(event, handler)
      }
    },
    [],
  )

  return {
    socket: socketRef.current,
    isConnected,
    connectionError,
    emit,
    on,
  }
}
