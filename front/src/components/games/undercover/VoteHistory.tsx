import { ChevronDown, ChevronUp } from "lucide-react"
import { memo, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface VoteEntry {
  voter: string
  voter_id: string
  target: string
  target_id: string
}

interface EliminatedInfo {
  username: string
  role: string
  user_id: string
}

interface VoteRound {
  round: number
  votes: VoteEntry[]
  eliminated: EliminatedInfo | null
}

interface VoteHistoryProps {
  history: VoteRound[]
}

const roleColors: Record<string, string> = {
  civilian: "text-green-600 dark:text-green-400",
  undercover: "text-red-600 dark:text-red-400",
  mr_white: "text-purple-600 dark:text-purple-400",
}

export const VoteHistory = memo(function VoteHistory({ history }: VoteHistoryProps) {
  const { t } = useTranslation()
  const [expandedRound, setExpandedRound] = useState<number | null>(null)

  if (history.length === 0) return null

  return (
    <div className="rounded-xl border bg-card p-4 mb-6">
      <h3 className="font-semibold mb-3">{t("game.undercover.voteHistory")}</h3>
      <div className="space-y-2">
        {history.map((round) => (
          <div key={round.round} className="rounded-lg border bg-muted/30">
            <button
              type="button"
              onClick={() => setExpandedRound(expandedRound === round.round ? null : round.round)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium"
            >
              <span>{t("game.undercover.round", { number: round.round })}</span>
              <div className="flex items-center gap-2">
                {round.eliminated && (
                  <span className={cn("text-xs", roleColors[round.eliminated.role] || "text-muted-foreground")}>
                    {round.eliminated.username}
                  </span>
                )}
                {expandedRound === round.round ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>
            {expandedRound === round.round && (
              <div className="px-3 pb-3 space-y-1">
                {round.votes.map((vote) => (
                  <div key={vote.voter_id} className="flex items-center text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{vote.voter}</span>
                    <span className="mx-1">&rarr;</span>
                    <span className="font-medium text-foreground">{vote.target}</span>
                  </div>
                ))}
                {round.eliminated && (
                  <div className={cn("text-xs font-medium mt-2 pt-2 border-t", roleColors[round.eliminated.role] || "text-muted-foreground")}>
                    {t("game.undercover.wasEliminated", {
                      username: round.eliminated.username,
                      role: round.eliminated.role,
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})
