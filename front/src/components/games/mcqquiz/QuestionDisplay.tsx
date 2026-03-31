import { memo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface QuestionDisplayProps {
  question: string
  currentRound: number
  totalRounds: number
  difficulty?: string | null
}

export const QuestionDisplay = memo(function QuestionDisplay({
  question,
  currentRound,
  totalRounds,
  difficulty,
}: QuestionDisplayProps) {
  const { t } = useTranslation()

  return (
    <div className="glass rounded-2xl border-border/30 p-6 text-center">
      <p className="text-xs font-mono tabular-nums text-muted-foreground mb-3">
        {t("game.mcqQuiz.round", { current: currentRound, total: totalRounds })}
      </p>
      {difficulty && (
        <span className={cn(
          "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider mb-3",
          difficulty === "easy" && "bg-emerald-500/15 text-emerald-500",
          difficulty === "medium" && "bg-amber-500/15 text-amber-500",
          difficulty === "hard" && "bg-red-500/15 text-red-500",
        )}>
          {t(`room.difficulty${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`)}
        </span>
      )}
      <h2 className="text-lg font-extrabold tracking-tight leading-relaxed">{question}</h2>
    </div>
  )
})
