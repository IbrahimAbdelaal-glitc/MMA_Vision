import { cx } from '../../utils/cx'
import { BACKEND_TONE_CLASSES, type BackendTone } from './backendTone'

interface BackendStatusProps {
  label: string
  detail: string
  tone: BackendTone
  className?: string
}

/**
 * Whether the dashboard can reach the analysis backend, and which job is
 * loaded. A polite live region, so losing the backend is announced.
 */
export function BackendStatus({ label, detail, tone, className }: BackendStatusProps) {
  return (
    <div role="status" aria-label="Backend status" className={cx('leading-none', className)}>
      <p
        className={cx(
          'text-[10px] leading-3 font-semibold whitespace-nowrap uppercase',
          BACKEND_TONE_CLASSES[tone],
        )}
      >
        {label}
      </p>
      <p className="mt-1.5 text-[11px] leading-[13px] whitespace-nowrap text-muted">{detail}</p>
    </div>
  )
}
