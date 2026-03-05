import { memo } from "react"
import { cn } from "@/lib/utils"

interface CodenamesCard {
  word: string
  card_type: "red" | "blue" | "neutral" | "assassin" | null
  revealed: boolean
}

interface CardCellProps {
  card: CodenamesCard
  index: number
  isSpymaster: boolean
  canGuess: boolean
  isFinished: boolean
  onGuess: (index: number) => void
}

export const CardCell = memo(function CardCell({
  card,
  index,
  isSpymaster,
  canGuess,
  isFinished,
  onGuess,
}: CardCellProps) {
  // Show color if: card revealed, player is spymaster, or game is finished (full reveal)
  const showColor = card.revealed || isSpymaster || isFinished
  let bgColor = "bg-card hover:bg-muted"

  if (showColor) {
    const isRevealed = card.revealed
    switch (card.card_type) {
      case "red":
        bgColor = isRevealed
          ? "bg-red-500 text-white"
          : isFinished
            ? "bg-red-200 dark:bg-red-900/40 text-red-900 dark:text-red-200 border-red-300 dark:border-red-800"
            : "bg-red-200 dark:bg-red-900/40 text-red-900 dark:text-red-200"
        break
      case "blue":
        bgColor = isRevealed
          ? "bg-blue-500 text-white"
          : isFinished
            ? "bg-blue-200 dark:bg-blue-900/40 text-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-800"
            : "bg-blue-200 dark:bg-blue-900/40 text-blue-900 dark:text-blue-200"
        break
      case "neutral":
        bgColor = isRevealed
          ? "bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200"
          : isFinished
            ? "bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800"
            : "bg-amber-50 dark:bg-amber-950/20"
        break
      case "assassin":
        bgColor = isRevealed
          ? "bg-gray-900 text-white"
          : isFinished
            ? "bg-gray-800 text-white border-gray-600"
            : "bg-gray-800 text-white"
        break
    }
  }

  return (
    <button
      type="button"
      onClick={() => onGuess(index)}
      disabled={!canGuess || card.revealed || isFinished}
      className={cn(
        "rounded-lg border p-3 text-center text-sm font-medium transition-all min-h-[60px] flex items-center justify-center",
        bgColor,
        card.revealed && "opacity-75",
        canGuess && !card.revealed && !isFinished && "cursor-pointer hover:shadow-md",
        (!canGuess || card.revealed || isFinished) && "cursor-default",
      )}
    >
      {card.word}
    </button>
  )
})
