import { createFileRoute } from "@tanstack/react-router"
import { Calendar, CheckCircle2, Clock, Flame, Target, Trophy } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import apiClient from "@/api/client"
import { useAuth } from "@/providers/AuthProvider"

interface ChallengeData {
  id: string
  code: string
  description: string
  challenge_type: string
  target_count: number
  game_type: string | null
  condition: string
  role: string | null
  progress: number
  completed: boolean
  assigned_at: string
  expires_at: string
}

export const Route = createFileRoute("/_auth/challenges")({
  component: ChallengesPage,
})

function getTimeRemaining(expiresAt: string): string {
  const now = Date.now()
  const expires = new Date(expiresAt).getTime()
  const diff = expires - now

  if (diff <= 0) return "Expired"

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function ChallengesPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [challenges, setChallenges] = useState<ChallengeData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return

    apiClient({
      method: "GET",
      url: "/api/v1/challenges/active",
    })
      .then((res) => setChallenges(res.data as ChallengeData[]))
      .catch(() => setChallenges([]))
      .finally(() => setIsLoading(false))
  }, [user?.id])

  const daily = useMemo(() => challenges.filter((c) => c.challenge_type === "daily"), [challenges])
  const weekly = useMemo(() => challenges.filter((c) => c.challenge_type === "weekly"), [challenges])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">{t("challenges.title")}</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border p-6 bg-muted/30 animate-pulse">
              <div className="h-10 w-10 rounded-lg bg-muted mb-3" />
              <div className="h-4 w-24 rounded bg-muted mb-2" />
              <div className="h-3 w-32 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">{t("challenges.title")}</h1>

      {challenges.length === 0 ? (
        <p className="text-muted-foreground">{t("challenges.noChallenges")}</p>
      ) : (
        <div className="space-y-8">
          {/* Daily Challenges */}
          {daily.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Flame className="h-5 w-5 text-orange-500" />
                <h2 className="text-xl font-semibold">{t("challenges.daily")}</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {daily.map((challenge) => (
                  <ChallengeCard key={challenge.id} challenge={challenge} />
                ))}
              </div>
            </section>
          )}

          {/* Weekly Challenges */}
          {weekly.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="h-5 w-5 text-blue-500" />
                <h2 className="text-xl font-semibold">{t("challenges.weekly")}</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {weekly.map((challenge) => (
                  <ChallengeCard key={challenge.id} challenge={challenge} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function ChallengeCard({ challenge }: { challenge: ChallengeData }) {
  const { t } = useTranslation()
  const progressPercent = Math.min((challenge.progress / challenge.target_count) * 100, 100)
  const timeRemaining = getTimeRemaining(challenge.expires_at)

  return (
    <div
      className={`rounded-xl border p-5 transition-all ${
        challenge.completed
          ? "bg-primary/5 border-primary/30"
          : "bg-card hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              challenge.completed
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {challenge.completed ? (
              <CheckCircle2 className="h-4.5 w-4.5" />
            ) : challenge.condition === "win" ? (
              <Trophy className="h-4.5 w-4.5" />
            ) : (
              <Target className="h-4.5 w-4.5" />
            )}
          </div>
          <div>
            <p className="font-medium text-sm leading-tight">{challenge.description}</p>
            {challenge.game_type && (
              <span className="text-[11px] text-muted-foreground capitalize">{challenge.game_type}</span>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {challenge.completed
              ? t("challenges.completed")
              : t("challenges.progress", {
                  current: challenge.progress,
                  target: challenge.target_count,
                })}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeRemaining}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              challenge.completed ? "bg-primary" : "bg-primary/50"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  )
}
