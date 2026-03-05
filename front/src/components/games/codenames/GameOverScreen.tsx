import { LogOut, RotateCcw } from "lucide-react"
import { memo, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import apiClient, { getApiErrorMessage } from "@/api/client"
import { cn } from "@/lib/utils"

interface GameOverScreenProps {
  winner: "red" | "blue"
  roomId: string | null
  onBackToRoom: () => void
  onLeaveRoom: () => void
}

export const GameOverScreen = memo(function GameOverScreen({
  winner,
  roomId,
  onBackToRoom,
  onLeaveRoom,
}: GameOverScreenProps) {
  const { t } = useTranslation()
  const [isRematchLoading, setIsRematchLoading] = useState(false)

  const handlePlayAgain = useCallback(async () => {
    if (!roomId || isRematchLoading) return
    setIsRematchLoading(true)
    try {
      await apiClient({
        method: "POST",
        url: `/api/v1/rooms/${roomId}/rematch`,
      })
      onBackToRoom()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to start rematch"))
    } finally {
      setIsRematchLoading(false)
    }
  }, [roomId, isRematchLoading, onBackToRoom])

  return (
    <div className="rounded-xl border bg-card p-8 text-center mt-6">
      <h2 className="text-3xl font-bold">{t("game.gameOver")}</h2>
      <p
        className={cn(
          "text-xl mt-4 font-semibold",
          winner === "red" ? "text-red-600" : "text-blue-600",
        )}
      >
        {winner === "red"
          ? t("games.codenames.teams.red")
          : t("games.codenames.teams.blue")}{" "}
        {t("game.codenames.wins")}
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        {roomId && (
          <button
            type="button"
            onClick={handlePlayAgain}
            disabled={isRematchLoading}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            {isRematchLoading ? t("common.loading") : t("game.playAgain")}
          </button>
        )}
        <button
          type="button"
          onClick={onLeaveRoom}
          className="inline-flex items-center gap-2 rounded-md border px-6 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
        >
          <LogOut className="h-4 w-4" />
          {t("room.leave")}
        </button>
      </div>
    </div>
  )
})
