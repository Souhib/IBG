import { createFileRoute, Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { Trophy } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import apiClient from "@/api/client"

interface LeaderboardEntry {
  user_id: string
  username: string
  total_games_played: number
  total_games_won: number
  win_rate: number
  current_win_streak: number
  longest_win_streak: number
}

type SortField = "total_games_won" | "win_rate" | "longest_win_streak"

export const Route = createFileRoute("/leaderboard")({
  component: LeaderboardPage,
})

function LeaderboardPage() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>("total_games_won")

  useEffect(() => {
    setIsLoading(true)
    apiClient({
      method: "GET",
      url: "/api/v1/stats/leaderboard",
      params: { stat_field: sortField, limit: 50 },
    })
      .then((res) => setEntries(res.data as LeaderboardEntry[]))
      .catch(() => setEntries([]))
      .finally(() => setIsLoading(false))
  }, [sortField])

  const sortTabs: { field: SortField; label: string }[] = [
    { field: "total_games_won", label: t("leaderboard.wins") },
    { field: "win_rate", label: t("leaderboard.winRate") },
    { field: "longest_win_streak", label: t("leaderboard.streak") },
  ]

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center gap-3 mb-8"
      >
        <Trophy className="h-8 w-8 text-accent" />
        <h1 className="text-3xl font-bold">{t("leaderboard.title")}</h1>
      </motion.div>

      {/* Sort Tabs */}
      <div className="flex gap-2 mb-4">
        {sortTabs.map((tab) => (
          <button
            key={tab.field}
            type="button"
            onClick={() => setSortField(tab.field)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              sortField === tab.field
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="rounded-xl border bg-card overflow-hidden"
      >
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                {t("leaderboard.rank")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                {t("leaderboard.player")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                {t("leaderboard.wins")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                {t("leaderboard.games")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                {t("leaderboard.winRate")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                {t("leaderboard.streak")}
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <tr key={i} className="border-b">
                    <td colSpan={6} className="px-6 py-4">
                      <div className="h-4 rounded bg-muted animate-pulse" />
                    </td>
                  </tr>
                ))}
              </>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  {t("leaderboard.noPlayers")}
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr key={entry.user_id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-3 text-sm font-medium">
                    {index < 3 ? ["🥇", "🥈", "🥉"][index] : `#${index + 1}`}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium">
                    <Link
                      to="/players/$userId"
                      params={{ userId: entry.user_id }}
                      className="hover:text-primary hover:underline transition-colors"
                    >
                      {entry.username}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-sm text-right">{entry.total_games_won}</td>
                  <td className="px-6 py-3 text-sm text-right">{entry.total_games_played}</td>
                  <td className="px-6 py-3 text-sm text-right">{entry.win_rate}%</td>
                  <td className="px-6 py-3 text-sm text-right">{entry.longest_win_streak}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </motion.div>
    </div>
  )
}
