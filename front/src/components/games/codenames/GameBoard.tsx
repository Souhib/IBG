import { memo, useMemo } from "react"
import { CardCell } from "./CardCell"

interface CodenamesCard {
  word: string
  card_type: "red" | "blue" | "neutral" | "assassin" | null
  revealed: boolean
  hint?: string | null
}

interface GameBoardProps {
  board: CodenamesCard[]
  isSpymaster: boolean
  canGuess: boolean
  isFinished: boolean
  onGuessCard: (index: number) => void
  cardVotes?: Record<string, number>
  currentUserId?: string
  onHintViewed?: (word: string) => void
}

export const GameBoard = memo(function GameBoard({
  board,
  isSpymaster,
  canGuess,
  isFinished,
  onGuessCard,
  cardVotes,
  currentUserId,
  onHintViewed,
}: GameBoardProps) {
  const { voteCounts, myVote } = useMemo(() => {
    const counts: Record<number, number> = {}
    let myVoteIdx: number | undefined
    if (cardVotes) {
      for (const [userId, cardIdx] of Object.entries(cardVotes)) {
        counts[cardIdx] = (counts[cardIdx] || 0) + 1
        if (currentUserId && userId === currentUserId) {
          myVoteIdx = cardIdx
        }
      }
    }
    return { voteCounts: counts, myVote: myVoteIdx }
  }, [cardVotes, currentUserId])

  return (
    <div className="grid grid-cols-5 gap-1 sm:gap-2.5 mb-6" style={{ perspective: "1200px" }}>
      {board.map((card, index) => (
        <CardCell
          key={index}
          card={card}
          index={index}
          isSpymaster={isSpymaster}
          canGuess={canGuess}
          isFinished={isFinished}
          onGuess={onGuessCard}
          voteCount={voteCounts[index]}
          isMyVote={myVote === index}
          onHintViewed={onHintViewed}
        />
      ))}
    </div>
  )
})
