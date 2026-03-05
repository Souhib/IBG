import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js"
import { useEffect, useState } from "react"
import { Line } from "react-chartjs-2"
import { useTranslation } from "react-i18next"
import apiClient from "@/api/client"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

interface DailyRecord {
  date: string
  wins: number
  losses: number
  total: number
}

export function WinLossChart({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const [data, setData] = useState<DailyRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    apiClient({ method: "GET", url: `/api/v1/stats/users/${userId}/history?days=30` })
      .then((res) => setData(res.data as DailyRecord[]))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [userId])

  if (isLoading) return <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">{t("common.loading")}</div>
  if (data.length === 0) return null

  const chartData = {
    labels: data.map((d) => new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
    datasets: [
      {
        label: t("stats.won"),
        data: data.map((d) => d.wins),
        borderColor: "hsl(142, 76%, 36%)",
        backgroundColor: "hsla(142, 76%, 36%, 0.1)",
        fill: true,
        tension: 0.3,
      },
      {
        label: t("stats.lost"),
        data: data.map((d) => d.losses),
        borderColor: "hsl(0, 72%, 51%)",
        backgroundColor: "hsla(0, 72%, 51%, 0.1)",
        fill: true,
        tension: 0.3,
      },
    ],
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h3 className="text-lg font-semibold mb-4">{t("stats.winLossOverTime")}</h3>
      <div className="h-64">
        <Line
          data={chartData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1 } },
            },
            plugins: {
              legend: { position: "bottom" },
            },
          }}
        />
      </div>
    </div>
  )
}
