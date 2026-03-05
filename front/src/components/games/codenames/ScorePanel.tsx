import { memo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface CodenamesTurn {
  team: "red" | "blue"
  clue_word: string | null
  clue_number: number
  guesses_made: number
  max_guesses: number | null
}

interface ScorePanelProps {
  redRemaining: number
  blueRemaining: number
  currentTeam: "red" | "blue"
  currentTurn: CodenamesTurn | null
  isMyTurn: boolean
  isFinished: boolean
}

export const ScorePanel = memo(function ScorePanel({
  redRemaining,
  blueRemaining,
  currentTeam,
  currentTurn,
  isMyTurn,
  isFinished,
}: ScorePanelProps) {
  const { t } = useTranslation()

  const guessProgress =
    currentTurn?.max_guesses && currentTurn.max_guesses > 0
      ? (currentTurn.guesses_made / currentTurn.max_guesses) * 100
      : 0

  return (
    <>
      {/* Header scores */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("games.codenames.name")}</h1>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full bg-red-500" />
            <span className="text-xl font-bold text-red-600 dark:text-red-400">{redRemaining}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full bg-blue-500" />
            <span className="text-xl font-bold text-blue-600 dark:text-blue-400">{blueRemaining}</span>
          </div>
        </div>
      </div>

      {/* Your Turn Indicator */}
      {isMyTurn && !isFinished && (
        <div className="mb-4 rounded-lg bg-primary/10 border border-primary/30 p-3 text-center animate-pulse">
          <span className="font-semibold text-primary">{t("game.codenames.yourTurn")}</span>
        </div>
      )}

      {/* Turn Info */}
      <div className="mb-4 rounded-lg bg-muted/50 p-3">
        <div className="text-center">
          <span
            className={cn(
              "font-semibold",
              currentTeam === "red" ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400",
            )}
          >
            {currentTeam === "red"
              ? t("games.codenames.teams.red")
              : t("games.codenames.teams.blue")}
          </span>
          {currentTurn?.clue_word && (
            <span className="ml-2 text-muted-foreground">
              — {currentTurn.clue_word} ({currentTurn.clue_number})
            </span>
          )}
        </div>
        {/* Guess progress bar */}
        {currentTurn?.clue_word && currentTurn.max_guesses != null && currentTurn.max_guesses > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>
                {t("game.codenames.guessesRemaining", {
                  made: currentTurn.guesses_made,
                  max: currentTurn.max_guesses,
                })}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  currentTeam === "red" ? "bg-red-500" : "bg-blue-500",
                )}
                style={{ width: `${Math.min(guessProgress, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
})
