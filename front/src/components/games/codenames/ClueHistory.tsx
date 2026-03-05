import { memo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface GuessEntry {
  word: string
  card_type: string
  correct: boolean
}

interface ClueHistoryEntry {
  team: "red" | "blue"
  clue_word: string
  clue_number: number
  guesses: GuessEntry[]
}

interface ClueHistoryProps {
  history: ClueHistoryEntry[]
}

export const ClueHistory = memo(function ClueHistory({ history }: ClueHistoryProps) {
  const { t } = useTranslation()

  if (history.length === 0) return null

  return (
    <div className="rounded-xl border bg-card p-4 mt-6">
      <h3 className="font-semibold mb-3">{t("game.codenames.clueHistory")}</h3>
      <div className="max-h-64 overflow-y-auto space-y-3">
        {[...history].reverse().map((entry, i) => (
          <div key={i} className="rounded-lg bg-muted/30 p-3">
            <div className="flex items-center gap-2 mb-1">
              <div
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  entry.team === "red" ? "bg-red-500" : "bg-blue-500",
                )}
              />
              <span className="text-sm font-medium">
                {entry.clue_word} ({entry.clue_number})
              </span>
            </div>
            {entry.guesses.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {entry.guesses.map((guess, j) => (
                  <span
                    key={j}
                    className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-xs",
                      guess.correct
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                    )}
                  >
                    {guess.word}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})
