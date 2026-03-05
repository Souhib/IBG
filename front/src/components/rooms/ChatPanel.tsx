import { MessageCircle, Send, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import apiClient, { getApiErrorMessage } from "@/api/client"
import { cn } from "@/lib/utils"

interface ChatMessage {
  id: string
  room_id: string
  user_id: string
  username: string
  message: string
  created_at: string
}

interface ChatPanelProps {
  roomId: string
  currentUserId: string
}

export function ChatPanel({ roomId, currentUserId }: ChatPanelProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const lastMessageIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  const fetchMessages = useCallback(async () => {
    try {
      const params: Record<string, string | number> = { limit: 50 }
      if (lastMessageIdRef.current) {
        params.after_id = lastMessageIdRef.current
      }
      const res = await apiClient({
        method: "GET",
        url: `/api/v1/rooms/${roomId}/messages`,
        params,
      })
      const newMessages = res.data as ChatMessage[]
      if (newMessages.length > 0) {
        lastMessageIdRef.current = newMessages[newMessages.length - 1].id
        if (lastMessageIdRef.current && messages.length > 0) {
          // Incremental update
          setMessages((prev) => [...prev, ...newMessages])
          if (!isOpen) {
            setUnreadCount((prev) => prev + newMessages.length)
          }
        } else {
          // Initial load
          setMessages(newMessages)
        }
        if (isOpen) {
          setTimeout(scrollToBottom, 50)
        }
      }
    } catch {
      // Silently fail on polling errors
    }
  }, [roomId, isOpen, messages.length, scrollToBottom])

  // Start polling
  useEffect(() => {
    fetchMessages()
    pollIntervalRef.current = setInterval(fetchMessages, 2000)
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [fetchMessages])

  // Scroll to bottom when opened
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0)
      setTimeout(scrollToBottom, 100)
    }
  }, [isOpen, scrollToBottom])

  const handleSend = async () => {
    const trimmed = newMessage.trim()
    if (!trimmed || isSending) return
    setIsSending(true)
    try {
      await apiClient({
        method: "POST",
        url: `/api/v1/rooms/${roomId}/messages`,
        data: { message: trimmed },
      })
      setNewMessage("")
      // Immediately fetch to show the sent message
      await fetchMessages()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setIsSending(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary p-4 text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
      >
        <MessageCircle className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex w-80 flex-col rounded-xl border bg-card shadow-xl sm:w-96">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("chat.title")}</h3>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ maxHeight: "320px", minHeight: "200px" }}>
        {messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">{t("chat.noMessages")}</p>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.user_id === currentUserId
            return (
              <div key={msg.id} className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}>
                {!isOwn && (
                  <span className="mb-0.5 text-[10px] font-medium text-muted-foreground">{msg.username}</span>
                )}
                <div
                  className={cn(
                    "max-w-[75%] rounded-lg px-3 py-2 text-sm break-words",
                    isOwn ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {msg.message}
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={t("chat.placeholder")}
            maxLength={500}
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending || !newMessage.trim()}
            className="rounded-md bg-primary p-2 text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
