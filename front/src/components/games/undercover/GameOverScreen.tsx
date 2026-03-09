import { BookOpen, LogOut, RotateCcw } from "lucide-react"
import { memo, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import apiClient, { getApiErrorMessage } from "@/api/client"

interface WordExplanations {
  civilian_word: string
  civilian_word_hint: string | null
  undercover_word: string
  undercover_word_hint: string | null
}

interface GameOverScreenProps {
  winner?: string
  roomId: string | null
  wordExplanations?: WordExplanations
  onBackToRoom: () => void
  onLeaveRoom: () => void
}

export const GameOverScreen = memo(function GameOverScreen({
  winner,
  roomId,
  wordExplanations,
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
    <div className="rounded-xl border bg-card p-8 text-center mb-8">
      <h2 className="text-3xl font-bold">{t("game.gameOver")}</h2>
      <p className="text-xl mt-4">
        {t("game.winner")}: {winner}
      </p>
      {/* Word Explanations — educational reveal */}
      {wordExplanations && (wordExplanations.civilian_word_hint || wordExplanations.undercover_word_hint) && (
        <div className="mt-6 rounded-lg border bg-muted/30 p-4 text-left">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {t("game.wordExplanations")}
          </h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("game.undercover.civilianWord")}</p>
              <p className="font-semibold">{wordExplanations.civilian_word}</p>
              {wordExplanations.civilian_word_hint && (
                <p className="text-sm text-muted-foreground mt-0.5">{wordExplanations.civilian_word_hint}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("game.undercover.undercoverWord")}</p>
              <p className="font-semibold">{wordExplanations.undercover_word}</p>
              {wordExplanations.undercover_word_hint && (
                <p className="text-sm text-muted-foreground mt-0.5">{wordExplanations.undercover_word_hint}</p>
              )}
            </div>
          </div>
        </div>
      )}

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
