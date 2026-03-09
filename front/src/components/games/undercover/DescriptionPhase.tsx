import { Loader2, MessageCircle } from "lucide-react"
import { memo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { HintButton } from "@/components/games/shared/HintButton"
import { cn } from "@/lib/utils"

interface DescriptionOrderEntry {
  user_id: string
  username: string
}

interface DescriptionPhaseProps {
  myRole?: string
  myWord?: string
  myWordHint?: string | null
  onHintViewed?: (word: string) => void
  descriptionOrder: DescriptionOrderEntry[]
  currentDescriberIndex: number
  descriptions: Record<string, string>
  currentUserId?: string
  isMyTurnToDescribe: boolean
  isAlive: boolean
  descriptionInput: string
  descriptionError: string
  isSubmittingDescription: boolean
  onDescriptionInputChange: (value: string) => void
  onSubmitDescription: () => void
}

export const DescriptionPhase = memo(function DescriptionPhase({
  myRole,
  myWord,
  myWordHint,
  onHintViewed,
  descriptionOrder,
  currentDescriberIndex,
  descriptions,
  currentUserId,
  isMyTurnToDescribe,
  isAlive,
  descriptionInput,
  descriptionError,
  isSubmittingDescription,
  onDescriptionInputChange,
  onSubmitDescription,
}: DescriptionPhaseProps) {
  const { t } = useTranslation()

  const handleHintView = useCallback(() => {
    if (myWord && onHintViewed) onHintViewed(myWord)
  }, [myWord, onHintViewed])

  const currentDescriber =
    descriptionOrder.length > 0 && currentDescriberIndex < descriptionOrder.length
      ? descriptionOrder[currentDescriberIndex]
      : null

  return (
    <div className="mb-8">
      {/* Role/Word reminder */}
      {myRole && myRole !== "mr_white" && myWord && (
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 mb-4 text-center">
          <span className="text-sm text-muted-foreground">{t("game.undercover.yourWordReminder")}:</span>{" "}
          <span className="font-bold text-primary">{myWord}</span>
          <HintButton hint={myWordHint ?? null} onView={handleHintView} />
        </div>
      )}

      <h2 className="text-xl font-bold text-center mb-4">{t("game.undercover.describeYourWord")}</h2>

      {/* Description Order */}
      {descriptionOrder.length > 0 && (
        <div className="rounded-lg border bg-card p-4 mb-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            {t("game.undercover.descriptionOrder")}
          </h3>
          <div className="space-y-1.5">
            {descriptionOrder.map((entry, idx) => {
              const hasDescribed = !!descriptions[entry.user_id]
              const isCurrent = idx === currentDescriberIndex && !hasDescribed
              return (
                <div
                  key={entry.user_id}
                  className={cn(
                    "flex items-center justify-between rounded-md px-3 py-1.5 text-sm",
                    isCurrent && "bg-primary/10 border border-primary/30",
                    hasDescribed && "opacity-60",
                  )}
                >
                  <span className={cn("font-medium", isCurrent && "text-primary")}>
                    {idx + 1}. {entry.username}
                    {entry.user_id === currentUserId && " (you)"}
                  </span>
                  {hasDescribed && (
                    <span className="text-xs bg-muted rounded-full px-2 py-0.5">
                      {descriptions[entry.user_id]}
                    </span>
                  )}
                  {isCurrent && !hasDescribed && (
                    <span className="text-xs text-primary font-semibold">
                      {entry.user_id === currentUserId ? t("game.undercover.yourTurn") : "..."}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Description Input (my turn) */}
      {isMyTurnToDescribe && isAlive && (
        <div className="rounded-lg border bg-card p-4 mb-4">
          <label htmlFor="description-input" className="block text-sm font-medium mb-2">
            {t("game.undercover.describeYourWord")}
          </label>
          <div className="flex gap-2">
            <input
              id="description-input"
              type="text"
              value={descriptionInput}
              onChange={(e) => onDescriptionInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmitDescription()
              }}
              placeholder={t("game.undercover.describeYourWord")}
              maxLength={50}
              disabled={isSubmittingDescription}
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={onSubmitDescription}
              disabled={isSubmittingDescription || !descriptionInput.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSubmittingDescription ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("game.undercover.submitDescription")
              )}
            </button>
          </div>
          {descriptionError && (
            <p className="text-xs text-destructive mt-1">{descriptionError}</p>
          )}
        </div>
      )}

      {/* Waiting message (not my turn) */}
      {!isMyTurnToDescribe && currentDescriber && (
        <div className="rounded-lg bg-muted/50 p-3 mb-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t("game.undercover.waitingForDescription", { username: currentDescriber.username })}
          </p>
        </div>
      )}

      {/* All descriptions done but transition not yet visible */}
      {currentDescriberIndex >= descriptionOrder.length && descriptionOrder.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 mb-4 text-center">
          <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
          <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
        </div>
      )}
    </div>
  )
})
