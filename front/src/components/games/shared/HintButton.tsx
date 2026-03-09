import * as Popover from "@radix-ui/react-popover"
import { Info } from "lucide-react"
import { memo, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"

interface HintButtonProps {
  hint: string | null
  onView?: () => void
  className?: string
}

export const HintButton = memo(function HintButton({ hint, onView, className }: HintButtonProps) {
  const hasNotified = useRef(false)

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !hasNotified.current && onView) {
        hasNotified.current = true
        onView()
      }
    },
    [onView],
  )

  if (!hint) return null

  return (
    <Popover.Root onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-full p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors",
            className,
          )}
          aria-label="Show explanation"
        >
          <Info className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 max-w-xs rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          sideOffset={5}
          align="center"
        >
          {hint}
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
})
