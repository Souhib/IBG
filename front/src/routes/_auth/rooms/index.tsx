import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Loader2, LogIn, Plus } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { motion } from "motion/react"
import { toast } from "sonner"
import { useSocket } from "@/hooks/use-socket"
import { useAuth } from "@/providers/AuthProvider"

export const Route = createFileRoute("/_auth/rooms/")({
  component: RoomsPage,
})

function RoomsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { emit, on, isConnected } = useSocket()
  const [roomCode, setRoomCode] = useState("")
  const [password, setPassword] = useState(["", "", "", ""])
  const [isJoining, setIsJoining] = useState(false)
  const pinRefs = useRef<(HTMLInputElement | null)[]>([])
  const joiningRef = useRef(false)

  // Listen for socket responses when joining
  useEffect(() => {
    if (!isConnected) return

    const offRoomStatus = on("room_status", (data: unknown) => {
      if (!joiningRef.current) return
      joiningRef.current = false
      setIsJoining(false)

      const payload = data as { data: { id?: string; users: unknown[] } }
      const roomId = payload.data?.id
      if (roomId) {
        navigate({ to: "/rooms/$roomId", params: { roomId } })
      }
    })

    const offError = on("error", (data: unknown) => {
      if (!joiningRef.current) return
      joiningRef.current = false
      setIsJoining(false)

      const payload = data as { frontend_message?: string; message?: string }
      toast.error(payload.frontend_message || payload.message || t("room.joinFailed"))
    })

    return () => {
      offRoomStatus()
      offError()
    }
  }, [isConnected, on, navigate, t])

  const handleRoomCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5)
    setRoomCode(value)
  }, [])

  const handlePinChange = useCallback((index: number, value: string) => {
    if (value.length > 1) {
      value = value.slice(-1)
    }
    if (value && !/^\d$/.test(value)) return

    setPassword((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })

    // Auto-advance to next input
    if (value && index < 3) {
      pinRefs.current[index + 1]?.focus()
    }
  }, [])

  const handlePinKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !password[index] && index > 0) {
      pinRefs.current[index - 1]?.focus()
    }
  }, [password])

  const handlePinPaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4)
    if (!pasted) return
    const digits = pasted.split("")
    setPassword((prev) => {
      const next = [...prev]
      digits.forEach((d, i) => {
        next[i] = d
      })
      return next
    })
    const focusIndex = Math.min(digits.length, 3)
    pinRefs.current[focusIndex]?.focus()
  }, [])

  const handleJoin = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (roomCode.length !== 5) {
        toast.error(t("room.invalidCode"))
        return
      }
      const pin = password.join("")
      if (pin.length !== 4) {
        toast.error(t("room.invalidPassword"))
        return
      }
      if (!user || !isConnected) return

      setIsJoining(true)
      joiningRef.current = true

      emit("join_room", {
        user_id: user.id,
        public_room_id: roomCode,
        password: pin,
      })

      // Timeout fallback in case no response comes back
      setTimeout(() => {
        if (joiningRef.current) {
          joiningRef.current = false
          setIsJoining(false)
          toast.error(t("room.joinFailed"))
        }
      }, 10000)
    },
    [roomCode, password, user, isConnected, emit, t],
  )

  const isFormValid = roomCode.length === 5 && password.every((d) => d !== "")

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold">{t("nav.rooms")}</h1>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Create Room Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Link
            to="/rooms/create"
            className="group flex flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center hover:border-primary/50 hover:shadow-md transition-all"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
              <Plus className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t("room.create")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("home.createRoom")}
              </p>
            </div>
          </Link>
        </motion.div>

        {/* Join Room Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="rounded-xl border bg-card p-8">
            <div className="flex flex-col items-center gap-4 mb-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <LogIn className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold">{t("room.join")}</h2>
            </div>

            <form onSubmit={handleJoin} className="space-y-5">
              {/* Room Code Input */}
              <div>
                <label htmlFor="room-code" className="block text-sm font-medium mb-2">
                  {t("room.roomCode")}
                </label>
                <input
                  id="room-code"
                  type="text"
                  value={roomCode}
                  onChange={handleRoomCodeChange}
                  placeholder={t("room.enterCode")}
                  autoFocus
                  maxLength={5}
                  className="w-full rounded-md border bg-background px-4 py-2.5 text-center font-mono text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-sm placeholder:tracking-normal"
                />
              </div>

              {/* Password PIN Input */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t("room.password")}
                </label>
                <div className="flex justify-center gap-3" onPaste={handlePinPaste}>
                  {password.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => { pinRefs.current[index] = el }}
                      type="text"
                      inputMode="numeric"
                      pattern="\d*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handlePinChange(index, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(index, e)}
                      className="h-12 w-12 rounded-md border bg-background text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label={`Password digit ${index + 1}`}
                    />
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground text-center">
                  {t("room.enterPassword")}
                </p>
              </div>

              {/* Join Button */}
              <button
                type="submit"
                disabled={!isFormValid || isJoining || !isConnected}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isJoining ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("room.joining")}
                  </>
                ) : (
                  t("room.join")
                )}
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
