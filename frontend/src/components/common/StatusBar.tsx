import { cx } from '../../utils/cx'
import { BACKEND_TONE_CLASSES, type BackendTone } from './backendTone'

interface StatusBarProps {
  label: string
  message: string
  /** Shown here only on small screens, where the top bar has no room for it. */
  backendLabel: string
  backendTone: BackendTone
  /**
   * The live engine's status line. Shown only on short screens in the overlay
   * layout, where the metrics panel has no room for its engine status block.
   */
  engineStatus?: { text: string; warn: boolean } | null
}

/** The strip along the bottom: what the dashboard is showing and how far to trust it. */
export function StatusBar({ label, message, backendLabel, backendTone, engineStatus = null }: StatusBarProps) {
  return (
    <footer className="relative z-20 border-t border-line bg-bar">
      <div className="flex min-h-10 flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 xl:px-6">
        <p className="caps-heading text-corner-blue">{label}</p>
        <p className="hidden text-[11px] leading-[14px] text-muted sm:block">{message}</p>
        {engineStatus && (
          <p
            aria-label="Live engine status (short screens)"
            className={cx(
              'hidden text-[11px] leading-[14px] font-semibold overlay:squat:block',
              engineStatus.warn ? 'text-warn' : 'text-fg-soft',
            )}
          >
            {engineStatus.text}
          </p>
        )}
        <p
          className={cx(
            'text-[10px] leading-3 font-semibold uppercase sm:hidden',
            BACKEND_TONE_CLASSES[backendTone],
          )}
        >
          {backendLabel}
        </p>
        <p className="ml-auto text-[11px] leading-[14px] text-muted">
          Experimental analysis · not official MMA judging
        </p>
      </div>
    </footer>
  )
}
