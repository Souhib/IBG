import { Shield } from "lucide-react"
import { memo } from "react"
import { useTranslation } from "react-i18next"

interface RoleRevealPhaseProps {
  myRole: string
  myWord?: string
  onDismiss: () => void
}

export const RoleRevealPhase = memo(function RoleRevealPhase({
  myRole,
  myWord,
  onDismiss,
}: RoleRevealPhaseProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-xl border bg-card p-8 text-center mb-8">
      <Shield className="h-12 w-12 mx-auto text-primary mb-4" />
      <h2 className="text-xl font-bold mb-2">{t("game.yourRole")}</h2>
      <div className="inline-block rounded-full bg-primary/10 px-6 py-2 text-lg font-bold text-primary">
        {myRole === "civilian"
          ? t("games.undercover.roles.civilian")
          : myRole === "undercover"
            ? t("games.undercover.roles.undercover")
            : t("games.undercover.roles.mrWhite")}
      </div>
      {myWord && (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">{t("game.yourWord")}</p>
          <p className="text-2xl font-bold mt-1">{myWord}</p>
        </div>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="mt-6 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {t("game.undercover.iUnderstand")}
      </button>
    </div>
  )
})
