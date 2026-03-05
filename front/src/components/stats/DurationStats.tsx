import { Clock } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import apiClient from "@/api/client"

interface DurationData {
  average_seconds: number
  fastest_seconds: number | null
  longest_seconds: number | null
  undercover_avg_seconds: number | null
  codenames_avg_seconds: number | null
  total_games_with_duration: number
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return "-"
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (mins === 0) return `${secs}s`
  return `${mins}m ${secs}s`
}

export function DurationStats({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const [data, setData] = useState<DurationData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    apiClient({ method: "GET", url: `/api/v1/stats/users/${userId}/duration` })
      .then((res) => setData(res.data as DurationData))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [userId])

  if (isLoading) return null
  if (!data || data.total_games_with_duration === 0) return null

  return (
    <div className="rounded-xl border bg-card p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Clock className="h-5 w-5 text-primary" />
        {t("stats.gameDuration")}
      </h3>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <div>
          <p className="text-sm text-muted-foreground">{t("stats.avgDuration")}</p>
          <p className="text-xl font-bold mt-1">{formatDuration(data.average_seconds)}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{t("stats.fastestGame")}</p>
          <p className="text-xl font-bold mt-1">{formatDuration(data.fastest_seconds)}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{t("stats.longestGame")}</p>
          <p className="text-xl font-bold mt-1">{formatDuration(data.longest_seconds)}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{t("stats.gamesTracked")}</p>
          <p className="text-xl font-bold mt-1">{data.total_games_with_duration}</p>
        </div>
      </div>
      {(data.undercover_avg_seconds || data.codenames_avg_seconds) && (
        <div className="grid gap-4 grid-cols-2 mt-4 pt-4 border-t">
          {data.undercover_avg_seconds && (
            <div>
              <p className="text-sm text-muted-foreground">{t("games.undercover.name")}</p>
              <p className="text-lg font-semibold">{formatDuration(data.undercover_avg_seconds)}</p>
            </div>
          )}
          {data.codenames_avg_seconds && (
            <div>
              <p className="text-sm text-muted-foreground">{t("games.codenames.name")}</p>
              <p className="text-lg font-semibold">{formatDuration(data.codenames_avg_seconds)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
