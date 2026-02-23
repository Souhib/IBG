import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import apiClient, { getApiErrorMessage } from "@/api/client"

export const Route = createFileRoute("/_auth/rooms/create")({
  component: CreateRoomPage,
})

function CreateRoomPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [gameType, setGameType] = useState<"undercover" | "codenames">("undercover")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const response = await apiClient({
        method: "POST",
        url: "/api/v1/rooms",
        data: {
          game_type: gameType,
        },
      })

      const room = response.data as { id: string }
      toast.success(t("toast.roomCreated"))
      navigate({ to: "/rooms/$roomId", params: { roomId: room.id } })
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">{t("room.create")}</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {/* Game Type */}
        <div>
          <label className="block text-sm font-medium mb-3">Game Type</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setGameType("undercover")}
              className={`rounded-lg border p-4 text-center transition-colors ${
                gameType === "undercover"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="font-semibold">{t("games.undercover.name")}</div>
              <div className="mt-1 text-xs text-muted-foreground">3-12 players</div>
            </button>
            <button
              type="button"
              onClick={() => setGameType("codenames")}
              className={`rounded-lg border p-4 text-center transition-colors ${
                gameType === "codenames"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="font-semibold">{t("games.codenames.name")}</div>
              <div className="mt-1 text-xs text-muted-foreground">4-10 players</div>
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isLoading ? t("common.loading") : t("room.create")}
        </button>
      </form>
    </div>
  )
}
