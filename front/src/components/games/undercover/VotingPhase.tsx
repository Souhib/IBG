import { Crown, MessageCircle, Skull, ThumbsUp, User } from "lucide-react"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface DescriptionOrderEntry {
  user_id: string
  username: string
}

interface UndercoverPlayer {
  id: string
  username: string
  is_alive: boolean
  is_mayor?: boolean
}

interface VotingPhaseProps {
  players: UndercoverPlayer[]
  myRole?: string
  myWord?: string
  descriptions: Record<string, string>
  descriptionOrder: DescriptionOrderEntry[]
  isAlive: boolean
  hasVoted: boolean
  selectedVote: string | null
  votedPlayers: string[]
  currentUserId?: string
  onSelectPlayer: (playerId: string) => void
  onConfirmVote: () => void
}

export const VotingPhase = memo(function VotingPhase({
  players,
  myRole,
  myWord,
  descriptions,
  descriptionOrder,
  isAlive,
  hasVoted,
  selectedVote,
  votedPlayers,
  currentUserId,
  onSelectPlayer,
  onConfirmVote,
}: VotingPhaseProps) {
  const { t } = useTranslation()

  return (
    <div className="mb-8">
      {/* Role/Word reminder */}
      {myRole && myRole !== "mr_white" && myWord && (
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 mb-4 text-center">
          <span className="text-sm text-muted-foreground">{t("game.undercover.yourWordReminder")}:</span>{" "}
          <span className="font-bold text-primary">{myWord}</span>
        </div>
      )}

      {/* Show descriptions from the describing phase */}
      {Object.keys(descriptions).length > 0 && (
        <div className="rounded-lg border bg-card p-4 mb-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            {t("game.undercover.descriptionOrder")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {descriptionOrder.map((entry) => {
              const word = descriptions[entry.user_id]
              if (!word) return null
              return (
                <div key={entry.user_id} className="rounded-md bg-muted px-3 py-1.5 text-sm">
                  <span className="font-medium">{entry.username}:</span>{" "}
                  <span className="text-primary font-semibold">{word}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!isAlive && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 mb-4 text-center">
          <Skull className="h-5 w-5 inline mr-2 text-destructive" />
          <span className="text-sm font-medium text-destructive">{t("game.undercover.youAreDead")}</span>
        </div>
      )}

      <h2 className="text-xl font-bold text-center mb-2">{t("game.undercover.discussAndVote")}</h2>
      <p className="text-sm text-muted-foreground text-center mb-4">{t("game.undercover.selectPlayerToVote")}</p>

      {hasVoted && (
        <div className="rounded-lg bg-muted/50 p-3 mb-4 text-center">
          <p className="text-sm text-muted-foreground">{t("game.undercover.waitingForVotes")}</p>
        </div>
      )}

      {isAlive && <div className="grid gap-3 sm:grid-cols-2">
        {players
          .filter((p) => p.is_alive && p.id !== currentUserId)
          .map((player) => {
            const hasPlayerVoted = votedPlayers.includes(player.id)
            return (
              <button
                key={player.id}
                type="button"
                onClick={() => onSelectPlayer(player.id)}
                disabled={hasVoted || !isAlive}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-4 transition-colors",
                  selectedVote === player.id
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                    : "hover:border-primary/50",
                  (hasVoted || !isAlive) && "opacity-50 cursor-not-allowed",
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <User className="h-5 w-5" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-medium flex items-center gap-2">
                    {player.username}
                    {player.is_mayor && (
                      <Crown className="h-3.5 w-3.5 text-yellow-500" />
                    )}
                  </div>
                  {selectedVote === player.id && !hasVoted && (
                    <div className="flex items-center gap-1 text-xs text-primary">
                      <ThumbsUp className="h-3 w-3" />
                      {t("game.undercover.selected")}
                    </div>
                  )}
                  {hasVoted && selectedVote === player.id && (
                    <div className="flex items-center gap-1 text-xs text-primary">
                      <ThumbsUp className="h-3 w-3" />
                      {t("game.undercover.voted")}
                    </div>
                  )}
                </div>
                {hasPlayerVoted && (
                  <span className="text-xs bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
                    {t("game.undercover.voted")}
                  </span>
                )}
              </button>
            )
          })}
      </div>}

      {/* Vote Confirmation Button */}
      {isAlive && !hasVoted && (
        <button
          type="button"
          onClick={onConfirmVote}
          disabled={!selectedVote}
          className={cn(
            "mt-4 w-full rounded-md px-6 py-3 text-sm font-semibold transition-colors",
            selectedVote
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {t("game.undercover.voteToEliminate")}
        </button>
      )}
    </div>
  )
})
