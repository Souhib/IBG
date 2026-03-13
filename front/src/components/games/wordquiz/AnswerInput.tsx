import { Check, Send, X } from "lucide-react"
import { memo, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

interface AnswerInputProps {
  onSubmit: (answer: string) => Promise<{ correct: boolean; points_earned: number } | null>
  disabled: boolean
  answered: boolean
  pointsEarned: number
}

export const AnswerInput = memo(function AnswerInput({ onSubmit, disabled, answered, pointsEarned }: AnswerInputProps) {
  const { t } = useTranslation()
  const [input, setInput] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<"correct" | "wrong" | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = input.trim()
      if (!trimmed || isSubmitting || disabled || answered) return
      setIsSubmitting(true)
      setLastResult(null)
      const result = await onSubmit(trimmed)
      if (result) {
        setLastResult(result.correct ? "correct" : "wrong")
        if (result.correct) {
          setInput("")
        }
        if (!result.correct) {
          setInput("")
          setTimeout(() => setLastResult(null), 1500)
        }
      }
      setIsSubmitting(false)
    },
    [input, isSubmitting, disabled, answered, onSubmit],
  )

  if (answered) {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-5 py-4"
      >
        <Check className="h-5 w-5 text-emerald-500" />
        <div>
          <p className="text-sm font-extrabold text-emerald-500">{t("game.wordQuiz.correct")}</p>
          <p className="text-xs text-emerald-500/80">{t("game.wordQuiz.pointsEarned", { points: pointsEarned })}</p>
        </div>
      </motion.div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("game.wordQuiz.typeYourAnswer")}
          disabled={disabled}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          className={cn(
            "w-full rounded-xl border-2 bg-background px-4 py-3 text-sm pr-12 transition-all duration-200 outline-none",
            lastResult === "wrong"
              ? "border-destructive/50 animate-shake"
              : "border-border/30 focus:border-primary/50 focus:ring-2 focus:ring-primary/20",
          )}
        />
        <button
          type="submit"
          disabled={!input.trim() || isSubmitting || disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-primary hover:bg-primary/10 disabled:opacity-30 transition-all duration-200"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {lastResult === "wrong" && (
        <motion.p
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-1 text-xs text-destructive"
        >
          <X className="h-3 w-3" />
          {t("game.wordQuiz.tryAgain")}
        </motion.p>
      )}
    </form>
  )
})
