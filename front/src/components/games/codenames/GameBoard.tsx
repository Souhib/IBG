import { memo } from "react"
import { CardCell } from "./CardCell"

interface CodenamesCard {
  word: string
  card_type: "red" | "blue" | "neutral" | "assassin" | null
  revealed: boolean
}

interface GameBoardProps {
  board: CodenamesCard[]
  isSpymaster: boolean
  canGuess: boolean
  isFinished: boolean
  onGuessCard: (index: number) => void
}

export const GameBoard = memo(function GameBoard({
  board,
  isSpymaster,
  canGuess,
  isFinished,
  onGuessCard,
}: GameBoardProps) {
  return (
    <div className="grid grid-cols-5 gap-2 mb-6">
      {board.map((card, index) => (
        <CardCell
          key={index}
          card={card}
          index={index}
          isSpymaster={isSpymaster}
          canGuess={canGuess}
          isFinished={isFinished}
          onGuess={onGuessCard}
        />
      ))}
    </div>
  )
})
