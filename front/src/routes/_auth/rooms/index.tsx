import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Loader2, LogIn, Plus } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { motion } from "motion/react"
import { toast } from "sonner"
import apiClient, { getApiErrorMessage } from "@/api/client"
import { useAuth } from "@/providers/AuthProvider"

export const Route = createFileRoute("/_auth/rooms/")({
  component: RoomsPage,
})

function RoomsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [roomCode, setRoomCode] = useState("")
  const [password, setPassword] = useState(["", "", "", ""])
  const [isJoining, setIsJoining] = useState(false)
  const pinRefs = useRef<(HTMLInputElement | null)[]>([])

  const handleRoomCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5)
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
    async (e: React.FormEvent) => {
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
      if (!user) return

      setIsJoining(true)
      try {
        const res = await apiClient({
          method: "PATCH",
          url: "/api/v1/rooms/join",
          data: {
            user_id: user.id,
            public_room_id: roomCode,
            password: pin,
          },
        })
        const data = res.data as { id?: string }
        if (data.id) {
          navigate({ to: "/rooms/$roomId", params: { roomId: data.id } })
        }
      } catch (err) {
        toast.error(getApiErrorMessage(err, t("room.joinFailed")))
      } finally {
        setIsJoining(false)
      }
    },
    [roomCode, password, user, navigate, t],
  )

  const isFormValid = roomCode.length === 5 && password.every((d) => d !== "")

  const { data: activeRoom } = useQuery({
    queryKey: ["active-room"],
    queryFn: () =>
      apiClient({ method: "GET", url: "/api/v1/rooms/active" }).then(
        (r) => r.data as { room_id: string; public_id: string; is_connected: boolean } | null,
      ),
    staleTime: 10_000,
  })

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold">{t("nav.rooms")}</h1>
      </div>

      {/* Rejoin Room Banner */}
      {activeRoom && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-5 py-3.5"
        >
          <div>
            <p className="text-sm font-medium">{t("room.rejoinRoom")}</p>
            <p className="text-xs text-muted-foreground">
              {t("room.roomCode")}: {activeRoom.public_id}
            </p>
          </div>
          <Link
            to="/rooms/$roomId"
            params={{ roomId: activeRoom.room_id }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("room.rejoinButton")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      )}

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
                  className="w-full rounded-md border bg-background px-4 py-2.5 text-center font-mono text-lg uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-sm placeholder:tracking-normal placeholder:normal-case"
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
                disabled={!isFormValid || isJoining}
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
