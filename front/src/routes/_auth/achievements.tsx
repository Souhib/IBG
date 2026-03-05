import { createFileRoute } from "@tanstack/react-router"
import { Award, Lock } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/providers/AuthProvider"
import apiClient from "@/api/client"

interface AchievementData {
  code: string
  name: string
  description: string
  icon: string
  category: string
  tier: number
  threshold: number
  progress: number
  unlocked: boolean
  rarity_percentage: number | null
}

function getRarityLabel(rarity: number | null): { label: string; color: string } | null {
  if (rarity === null) return null
  if (rarity <= 1) return { label: "Mythic", color: "text-red-500 bg-red-500/10" }
  if (rarity <= 5) return { label: "Legendary", color: "text-purple-500 bg-purple-500/10" }
  if (rarity <= 15) return { label: "Epic", color: "text-yellow-500 bg-yellow-500/10" }
  if (rarity <= 30) return { label: "Rare", color: "text-blue-500 bg-blue-500/10" }
  return { label: "Common", color: "text-muted-foreground bg-muted" }
}

const TIER_COLORS: Record<number, string> = {
  1: "border-amber-700/40 bg-amber-900/10",
  2: "border-gray-400/40 bg-gray-200/10",
  3: "border-yellow-500/40 bg-yellow-500/10",
  4: "border-emerald-500/40 bg-emerald-500/10",
  5: "border-purple-500/40 bg-purple-500/10",
  6: "border-red-500/40 bg-red-500/10",
}

const TIER_LABELS: Record<number, string> = {
  1: "Bronze",
  2: "Silver",
  3: "Gold",
  4: "Emerald",
  5: "Diamond",
  6: "Mythic",
}

export const Route = createFileRoute("/_auth/achievements")({
  component: AchievementsPage,
})

function AchievementsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [achievements, setAchievements] = useState<AchievementData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return

    apiClient({
      method: "GET",
      url: `/api/v1/stats/users/${user.id}/achievements`,
    })
      .then((res) => setAchievements(res.data as AchievementData[]))
      .catch(() => setAchievements([]))
      .finally(() => setIsLoading(false))
  }, [user?.id])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">{t("achievements.title")}</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
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
      <h1 className="text-3xl font-bold mb-8">{t("achievements.title")}</h1>

      {achievements.length === 0 ? (
        <p className="text-muted-foreground">{t("achievements.noAchievements")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.map((achievement) => (
            <div
              key={achievement.code}
              className={`rounded-xl border p-6 ${
                achievement.unlocked
                  ? `bg-card ${TIER_COLORS[achievement.tier] || "border-primary/30"}`
                  : "bg-muted/30 border-border opacity-60"
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    achievement.unlocked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {achievement.unlocked ? (
                    <Award className="h-5 w-5" />
                  ) : (
                    <Lock className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{achievement.name}</h3>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {TIER_LABELS[achievement.tier] || `Tier ${achievement.tier}`}
                    </span>
                    {(() => {
                      const rarity = getRarityLabel(achievement.rarity_percentage)
                      if (!rarity) return null
                      return (
                        <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${rarity.color}`}>
                          {rarity.label} ({achievement.rarity_percentage}%)
                        </span>
                      )
                    })()}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{achievement.description}</p>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {achievement.unlocked
                      ? t("achievements.unlocked")
                      : t("achievements.progress", {
                          current: Math.min(achievement.progress, achievement.threshold),
                          target: achievement.threshold,
                        })}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      achievement.unlocked ? "bg-primary" : "bg-primary/50"
                    }`}
                    style={{
                      width: `${Math.min((achievement.progress / achievement.threshold) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
