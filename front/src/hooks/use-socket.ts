import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Socket } from "socket.io-client"
import { toast } from "sonner"
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket"
import { useAuth } from "@/providers/AuthProvider"

/**
 * Hook to manage Socket.IO connection with authentication.
 * Automatically connects when authenticated and disconnects on logout.
 */
export function useSocket() {
  const { isAuthenticated } = useAuth()
  const { t } = useTranslation()
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const wasConnectedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket()
      setIsConnected(false)
      socketRef.current = null
      wasConnectedRef.current = false
      return
    }

    const socket = getSocket()
    socketRef.current = socket

    const onConnect = () => {
      setIsConnected(true)
      if (wasConnectedRef.current) {
        toast.success(t("toast.connectionRestored"))
      }
      wasConnectedRef.current = true
    }
    const onDisconnect = (reason: string) => {
      setIsConnected(false)
      // Only show toast for unexpected disconnects, not intentional ones
      if (reason !== "io client disconnect") {
        toast.error(t("toast.connectionLost"))
      }
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)

    // If already connected (singleton from previous page), update state immediately
    if (socket.connected) {
      setIsConnected(true)
    }

    connectSocket()

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
    }
  }, [isAuthenticated])

  const emit = useCallback(
    (event: string, data?: unknown) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit(event, data)
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
    emit,
    on,
  }
}
