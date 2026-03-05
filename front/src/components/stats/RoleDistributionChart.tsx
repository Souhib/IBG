import { ArcElement, Chart as ChartJS, Legend, Tooltip } from "chart.js"
import { Doughnut } from "react-chartjs-2"
import { useTranslation } from "react-i18next"

ChartJS.register(ArcElement, Tooltip, Legend)

interface RoleDistributionProps {
  timesCivilian: number
  timesUndercover: number
  timesMrWhite: number
  timesSpymaster: number
  timesOperative: number
}

export function RoleDistributionChart({
  timesCivilian,
  timesUndercover,
  timesMrWhite,
  timesSpymaster,
  timesOperative,
}: RoleDistributionProps) {
  const { t } = useTranslation()

  const total = timesCivilian + timesUndercover + timesMrWhite + timesSpymaster + timesOperative
  if (total === 0) return null

  const data = {
    labels: [
      t("games.undercover.roles.civilian"),
      t("games.undercover.roles.undercover"),
      t("games.undercover.roles.mrWhite"),
      t("games.codenames.roles.spymaster"),
      t("games.codenames.roles.operative"),
    ],
    datasets: [
      {
        data: [timesCivilian, timesUndercover, timesMrWhite, timesSpymaster, timesOperative],
        backgroundColor: [
          "hsl(142, 76%, 36%)",
          "hsl(0, 72%, 51%)",
          "hsl(271, 91%, 65%)",
          "hsl(217, 91%, 60%)",
          "hsl(45, 93%, 47%)",
        ],
        borderWidth: 0,
      },
    ],
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h3 className="text-lg font-semibold mb-4">{t("stats.roleDistribution")}</h3>
      <div className="h-64 flex items-center justify-center">
        <Doughnut
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: "bottom" },
            },
          }}
        />
      </div>
    </div>
  )
}
