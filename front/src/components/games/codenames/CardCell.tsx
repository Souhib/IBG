import { memo, useCallback } from "react"
import { HintButton } from "@/components/games/shared/HintButton"
import { cn } from "@/lib/utils"

interface CodenamesCard {
  word: string
  card_type: "red" | "blue" | "neutral" | "assassin" | null
  revealed: boolean
  hint?: string | null
}

interface CardCellProps {
  card: CodenamesCard
  index: number
  isSpymaster: boolean
  canGuess: boolean
  isFinished: boolean
  onGuess: (index: number) => void
  voteCount?: number
  isMyVote?: boolean
  onHintViewed?: (word: string) => void
}

export const CardCell = memo(function CardCell({
  card,
  index,
  isSpymaster,
  canGuess,
  isFinished,
  onGuess,
  voteCount,
  isMyVote,
  onHintViewed,
}: CardCellProps) {
  const handleHintView = useCallback(() => {
    if (onHintViewed) onHintViewed(card.word)
  }, [onHintViewed, card.word])
  // Show color if: card revealed, player is spymaster, or game is finished (full reveal)
  const showColor = card.revealed || isSpymaster || isFinished
  let bgColor = "bg-surface hover:bg-muted/60 border-border/50"

  if (showColor) {
    const isRevealed = card.revealed
    switch (card.card_type) {
      case "red":
        bgColor = isRevealed
          ? "bg-red-500 text-white border-red-600 shadow-red-500/20 shadow-md"
          : isFinished
            ? "bg-red-200 dark:bg-red-900/40 text-red-900 dark:text-red-200 border-red-300 dark:border-red-800"
            : "bg-red-200/80 dark:bg-red-900/30 text-red-900 dark:text-red-200 border-red-300/50 dark:border-red-800/50"
        break
      case "blue":
        bgColor = isRevealed
          ? "bg-blue-500 text-white border-blue-600 shadow-blue-500/20 shadow-md"
          : isFinished
            ? "bg-blue-200 dark:bg-blue-900/40 text-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-800"
            : "bg-blue-200/80 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200 border-blue-300/50 dark:border-blue-800/50"
        break
      case "neutral":
        bgColor = isRevealed
          ? "bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 border-amber-300"
          : isFinished
            ? "bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800"
            : "bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30"
        break
      case "assassin":
        bgColor = isRevealed
          ? "bg-gray-900 text-white border-gray-700 shadow-gray-900/30 shadow-md"
          : isFinished
            ? "bg-gray-800 text-white border-gray-600"
            : "bg-gray-800 text-white border-gray-700"
        break
    }
  }

  return (
    <button
      type="button"
      onClick={() => onGuess(index)}
      disabled={!canGuess || card.revealed || isFinished}
      className={cn(
        "relative rounded-xl border p-1.5 sm:p-3 text-center text-[10px] sm:text-sm font-semibold transition-all duration-200 min-h-[44px] sm:min-h-[60px] flex items-center justify-center",
        bgColor,
        card.revealed && "opacity-80 scale-[0.97]",
        canGuess && !card.revealed && !isFinished && "cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.97]",
        (!canGuess || card.revealed || isFinished) && "cursor-default",
        isMyVote && !card.revealed && "ring-2 ring-primary ring-offset-2 ring-offset-background animate-glow-pulse",
      )}
    >
      {card.word}
      {card.hint && (card.revealed || isSpymaster || isFinished) && (
        <span className="absolute top-0.5 left-0.5">
          <HintButton hint={card.hint} onView={handleHintView} className="p-0.5" />
        </span>
      )}
      {!!voteCount && voteCount > 0 && !card.revealed && (
        <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-[10px] font-bold text-primary-foreground shadow-md shadow-primary/30">
          {voteCount}
        </span>
      )}
    </button>
  )
})
