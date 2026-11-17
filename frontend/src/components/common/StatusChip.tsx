import { cx } from '../../utils/cx'

/**
 * neutral  nothing loaded
 * ready    a local preview
 * busy     uploading, queued or processing
 * done     the analysis finished
 * error    the analysis failed or the job cannot be followed
 */
export type StatusTone = 'neutral' | 'ready' | 'busy' | 'done' | 'error'

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-panel-raised text-muted',
  ready: 'bg-[#1c2a1e] text-sage',
  busy: 'bg-warn-surface text-warn',
  done: 'bg-[#211c2e] text-ended',
  error: 'bg-corner-red-surface text-corner-red',
}

/** The one-glance system status in the top bar. */
export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-[26px] items-center rounded px-3 text-[9px] font-bold tracking-[0.6px] whitespace-nowrap uppercase',
        TONE_CLASSES[tone],
      )}
    >
      {label}
    </span>
  )
}
