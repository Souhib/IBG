import { BookOpen, LogOut, RotateCcw } from "lucide-react"
import { memo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { getApiErrorMessage } from "@/api/client"
import { useRematchApiV1RoomsRoomIdRematchPost } from "@/api/generated"

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

const WINNER_KEYS: Record<string, string> = {
  civilians: "games.undercover.roles.civilian",
  undercovers: "games.undercover.roles.undercover",
}

export const GameOverScreen = memo(function GameOverScreen({
  winner,
  roomId,
  wordExplanations,
  onBackToRoom,
  onLeaveRoom,
}: GameOverScreenProps) {
  const { t } = useTranslation()
  const rematchMutation = useRematchApiV1RoomsRoomIdRematchPost()
  const isRematchLoading = rematchMutation.isPending

  const handlePlayAgain = useCallback(async () => {
    if (!roomId || isRematchLoading) return
    try {
      await rematchMutation.mutateAsync({ room_id: roomId })
      onBackToRoom()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to start rematch"))
    }
  }, [roomId, isRematchLoading, onBackToRoom, rematchMutation])

  return (
    <div className="glass rounded-2xl p-8 text-center mb-8 animate-scale-in">
      <h2 className="text-4xl font-extrabold tracking-tight">{t("game.gameOver")}</h2>
      <div className="inline-block mt-4 rounded-2xl bg-gradient-to-r from-primary/15 to-accent/15 px-6 py-2.5">
        <p className="text-xl font-bold text-primary">
          {t("game.winner")}: {winner && WINNER_KEYS[winner] ? t(WINNER_KEYS[winner]) : winner}
        </p>
      </div>

      {/* Word Explanations */}
      {wordExplanations && (wordExplanations.civilian_word_hint || wordExplanations.undercover_word_hint) && (
        <div className="mt-6 rounded-2xl border border-border/30 bg-muted/20 p-5 text-left">
          <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            {t("game.wordExplanations")}
          </h3>
          <div className="space-y-3">
            <div className="rounded-xl bg-surface border border-border/30 px-4 py-3">
              <p className="text-xs text-muted-foreground font-medium">{t("game.undercover.civilianWord")}</p>
              <p className="font-bold mt-0.5">{wordExplanations.civilian_word}</p>
              {wordExplanations.civilian_word_hint && (
                <p className="text-sm text-muted-foreground mt-1">{wordExplanations.civilian_word_hint}</p>
              )}
            </div>
            <div className="rounded-xl bg-surface border border-border/30 px-4 py-3">
              <p className="text-xs text-muted-foreground font-medium">{t("game.undercover.undercoverWord")}</p>
              <p className="font-bold mt-0.5">{wordExplanations.undercover_word}</p>
              {wordExplanations.undercover_word_hint && (
                <p className="text-sm text-muted-foreground mt-1">{wordExplanations.undercover_word_hint}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-3">
        {roomId && (
          <button
            type="button"
            onClick={handlePlayAgain}
            disabled={isRematchLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/90 px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:-translate-y-px disabled:opacity-50 transition-all duration-200"
          >
            <RotateCcw className="h-4 w-4" />
            {isRematchLoading ? t("common.loading") : t("game.playAgain")}
          </button>
        )}
        <button
          type="button"
          onClick={onLeaveRoom}
          className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-6 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-glow transition-all duration-200"
        >
          <LogOut className="h-4 w-4" />
          {t("room.leave")}
        </button>
      </div>
    </div>
  )
})
