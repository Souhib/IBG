import { createFileRoute, Link } from "@tanstack/react-router"
import { Award, BarChart3, Gamepad2, Swords, UserPlus } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import apiClient, { getApiErrorMessage } from "@/api/client"
import { useAuth } from "@/providers/AuthProvider"

interface PublicProfile {
  user_id: string
  username: string
  bio: string | null
  total_games_played: number
  total_games_won: number
  win_rate: number
  current_win_streak: number
}

export const Route = createFileRoute("/players/$userId")({
  component: PlayerProfilePage,
})

function PlayerProfilePage() {
  const { userId } = Route.useParams()
  const { t } = useTranslation()
  const { user } = useAuth()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSendingRequest, setIsSendingRequest] = useState(false)
  const [h2h, setH2h] = useState<{ user_wins: number; opponent_wins: number; draws: number; total_games: number } | null>(null)

  const isOwnProfile = user?.id === userId

  useEffect(() => {
    setIsLoading(true)
    setError(null)
    apiClient({
      method: "GET",
      url: `/api/v1/profiles/users/${userId}`,
    })
      .then((res) => setProfile(res.data as PublicProfile))
      .catch((err) => setError(getApiErrorMessage(err, t("common.error"))))
      .finally(() => setIsLoading(false))
  }, [userId, t])

  // Fetch head-to-head stats if viewing another player's profile
  useEffect(() => {
    if (!user?.id || isOwnProfile) return
    apiClient({
      method: "GET",
      url: `/api/v1/stats/users/${user.id}/vs/${userId}`,
    })
      .then((res) => setH2h(res.data as { user_wins: number; opponent_wins: number; draws: number; total_games: number }))
      .catch(() => {})
  }, [user?.id, userId, isOwnProfile])

  const handleAddFriend = async () => {
    if (isSendingRequest) return
    setIsSendingRequest(true)
    try {
      await apiClient({
        method: "POST",
        url: "/api/v1/friends/request",
        data: { addressee_id: userId },
      })
      toast.success(t("friends.requestSent"))
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setIsSendingRequest(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="rounded-md bg-destructive/10 p-4 text-center text-destructive">
          {error ?? t("common.error")}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Profile Header */}
      <div className="rounded-xl border bg-card p-8 mb-8">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{profile.username}</h1>
            {profile.bio && (
              <p className="mt-1 text-muted-foreground">{profile.bio}</p>
            )}
          </div>
          {!isOwnProfile && user && (
            <button
              type="button"
              onClick={handleAddFriend}
              disabled={isSendingRequest}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              {t("friends.addFriend")}
            </button>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 sm:grid-cols-4 mb-8">
        <div className="rounded-xl border bg-card p-5 text-center">
          <p className="text-2xl font-bold">{profile.total_games_played}</p>
          <p className="text-sm text-muted-foreground">{t("stats.gamesPlayed")}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 text-center">
          <p className="text-2xl font-bold">{profile.total_games_won}</p>
          <p className="text-sm text-muted-foreground">{t("stats.gamesWon")}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 text-center">
          <p className="text-2xl font-bold">{profile.win_rate}%</p>
          <p className="text-sm text-muted-foreground">{t("stats.winRate")}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 text-center">
          <p className="text-2xl font-bold">{profile.current_win_streak}</p>
          <p className="text-sm text-muted-foreground">{t("stats.currentStreak")}</p>
        </div>
      </div>

      {/* Head-to-Head */}
      {!isOwnProfile && h2h && h2h.total_games > 0 && (
        <div className="rounded-xl border bg-card p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Swords className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{t("stats.headToHead")}</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-primary">{h2h.user_wins}</p>
              <p className="text-xs text-muted-foreground">{t("stats.yourWins")}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-muted-foreground">{h2h.draws}</p>
              <p className="text-xs text-muted-foreground">{t("stats.draws")}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-destructive">{h2h.opponent_wins}</p>
              <p className="text-xs text-muted-foreground">{t("stats.theirWins")}</p>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {t("stats.totalGames", { count: h2h.total_games })}
          </p>
        </div>
      )}

      {/* Quick Links */}
      {isOwnProfile && (
        <div className="grid gap-4 md:grid-cols-3">
          <Link
            to="/stats"
            className="rounded-xl border bg-card p-6 hover:shadow-md transition-shadow"
          >
            <BarChart3 className="h-8 w-8 text-primary mb-3" />
            <h3 className="font-semibold">{t("stats.title")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("profile.viewStats")}</p>
          </Link>

          <Link
            to="/achievements"
            className="rounded-xl border bg-card p-6 hover:shadow-md transition-shadow"
          >
            <Award className="h-8 w-8 text-accent mb-3" />
            <h3 className="font-semibold">{t("achievements.title")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("profile.viewAchievements")}</p>
          </Link>

          <Link
            to="/rooms"
            className="rounded-xl border bg-card p-6 hover:shadow-md transition-shadow"
          >
            <Gamepad2 className="h-8 w-8 text-primary mb-3" />
            <h3 className="font-semibold">{t("nav.rooms")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("profile.joinOrCreate")}</p>
          </Link>
        </div>
      )}
    </div>
  )
}
