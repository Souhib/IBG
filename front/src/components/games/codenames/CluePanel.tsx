import { memo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface CluePanelProps {
  clueWord: string
  clueNumber: number
  isSubmitting: boolean
  onClueWordChange: (value: string) => void
  onClueNumberChange: (value: number) => void
  onSubmit: () => void
}

export const CluePanel = memo(function CluePanel({
  clueWord,
  clueNumber,
  isSubmitting,
  onClueWordChange,
  onClueNumberChange,
  onSubmit,
}: CluePanelProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-xl border bg-card p-4 mb-4">
      <h3 className="font-semibold mb-2">{t("game.codenames.giveClue")}</h3>
      <p className="text-xs text-muted-foreground mb-3">
        {t("game.codenames.guessesRemaining", { made: 0, max: clueNumber + 1 })}
      </p>
      <div className="flex gap-3">
        <input
          type="text"
          value={clueWord}
          onChange={(e) => onClueWordChange(e.target.value)}
          placeholder={t("game.codenames.cluePlaceholder")}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="number"
          value={clueNumber}
          onChange={(e) => onClueNumberChange(parseInt(e.target.value) || 1)}
          min={1}
          max={9}
          className="w-16 rounded-md border bg-background px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting}
          className={cn(
            "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90",
            isSubmitting && "opacity-50 cursor-not-allowed",
          )}
        >
          {isSubmitting ? t("game.codenames.sending") : t("common.submit")}
        </button>
      </div>
    </div>
  )
})
