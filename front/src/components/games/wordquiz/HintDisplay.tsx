import { motion } from "motion/react"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface HintDisplayProps {
  hints: string[]
  hintsRevealed: number
  maxHints: number
  difficulty?: string | null
}

export const HintDisplay = memo(function HintDisplay({ hints, hintsRevealed, maxHints, difficulty }: HintDisplayProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold tracking-tight">{t("game.wordQuiz.hint")}</h3>
        {difficulty && (
          <span className={cn(
            "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            difficulty === "easy" && "bg-emerald-500/15 text-emerald-500",
            difficulty === "medium" && "bg-amber-500/15 text-amber-500",
            difficulty === "hard" && "bg-red-500/15 text-red-500",
          )}>
            {t(`room.difficulty${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`)}
          </span>
        )}
        <span className="text-xs font-mono tabular-nums text-muted-foreground">
          {t("game.wordQuiz.hintNumber", { number: hintsRevealed, total: maxHints })}
        </span>
      </div>
      <div className="space-y-2">
        {hints.slice(0, hintsRevealed).map((hint, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index === hintsRevealed - 1 ? 0.1 : 0 }}
            className={cn(
              "rounded-xl px-4 py-3 text-sm border transition-all duration-200",
              index === hintsRevealed - 1
                ? "glass border-primary/30 bg-primary/5 text-foreground font-medium shadow-sm"
                : "border-border/20 bg-muted/20 text-muted-foreground",
            )}
          >
            <span className="font-mono text-xs text-muted-foreground mr-2">#{index + 1}</span>
            {hint}
          </motion.div>
        ))}
      </div>
    </div>
  )
})
