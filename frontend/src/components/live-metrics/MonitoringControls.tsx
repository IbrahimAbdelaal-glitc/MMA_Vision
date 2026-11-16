import { Pause, Play, Square } from 'lucide-react'
import { useId, type ReactNode } from 'react'

/**
 * Start, pause and end controls for a monitoring session.
 *
 * There is no live engine to control yet, so every button is disabled and the
 * reason is shown underneath (and read out to screen readers through
 * aria-describedby). Nothing here pretends to start anything.
 *
 * The block sits on its own panel so the reason stays readable over video. On
 * the shortest screens the panel and the visible reason are dropped to save
 * height; the reason is still announced to screen readers.
 */
export function MonitoringControls({ unavailableReason }: { unavailableReason: string }) {
  const reasonId = useId()

  return (
    <div className="mt-2 rounded-lg border border-line-strong bg-hud/92 p-2 backdrop-blur-sm squat:border-0 squat:bg-transparent squat:p-0 squat:backdrop-blur-none">
      <div className="grid grid-cols-3 gap-2">
        <ControlButton label="Start monitoring" describedBy={reasonId}>
          <Play size={13} aria-hidden />
          Start
        </ControlButton>
        <ControlButton label="Pause monitoring" describedBy={reasonId}>
          <Pause size={13} aria-hidden />
          Pause
        </ControlButton>
        <ControlButton label="End monitoring" describedBy={reasonId}>
          <Square size={11} aria-hidden />
          End
        </ControlButton>
      </div>
      <p id={reasonId} className="mt-1.5 px-0.5 text-[10px] leading-[13px] text-muted squat:sr-only">
        {unavailableReason}
      </p>
    </div>
  )
}

function ControlButton({
  label,
  describedBy,
  children,
}: {
  label: string
  describedBy: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      aria-describedby={describedBy}
      className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-control text-xs font-semibold text-fg disabled:opacity-45"
    >
      {children}
    </button>
  )
}
