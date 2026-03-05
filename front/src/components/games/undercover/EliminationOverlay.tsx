import { Skull } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface EliminationOverlayProps {
  eliminatedUsername?: string
  eliminatedRole?: string
  onNextRound: () => void
}

const roleConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
  civilian: {
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    label: "Civilian",
  },
  undercover: {
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    label: "Undercover",
  },
  mr_white: {
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
    label: "Mr. White",
  },
}

export const EliminationOverlay = memo(function EliminationOverlay({
  eliminatedUsername,
  eliminatedRole,
  onNextRound,
}: EliminationOverlayProps) {
  const { t } = useTranslation()
  const config = roleConfig[eliminatedRole ?? ""] ?? roleConfig.civilian

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.4 }}
        className={cn("rounded-xl border-2 p-8 text-center mb-8", config.bg, config.border)}
      >
        {/* Skull icon with bounce */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
        >
          <Skull className={cn("h-14 w-14 mx-auto mb-4", config.color)} />
        </motion.div>

        {/* Title */}
        <motion.h2
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-xl font-bold"
        >
          {t("game.eliminated")}
        </motion.h2>

        {/* Player name */}
        {eliminatedUsername && (
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-lg font-semibold mt-2"
          >
            {eliminatedUsername}
          </motion.p>
        )}

        {/* Role reveal card */}
        {eliminatedRole && (
          <motion.div
            initial={{ rotateY: 90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className={cn(
              "inline-block mt-3 rounded-lg border px-4 py-2",
              config.border,
              config.bg,
            )}
          >
            <span className={cn("text-sm font-semibold", config.color)}>
              {t("game.yourRole")}: {config.label}
            </span>
          </motion.div>
        )}

        {/* Next Round button */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.0 }}
        >
          <button
            type="button"
            onClick={onNextRound}
            className="mt-6 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("game.undercover.nextRound")}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
})
