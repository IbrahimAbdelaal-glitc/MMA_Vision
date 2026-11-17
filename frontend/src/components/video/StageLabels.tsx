import type { ReactNode } from 'react'
import type { LocalVideoSource } from '../../types/dashboard'
import { cx } from '../../utils/cx'
import { formatFileSize } from '../../utils/format'

/** The translucent surface shared by the labels that sit over the video. */
export const LABEL_SURFACE =
  'rounded-md border border-line-strong/70 bg-hud/90 px-3.5 py-2.5 backdrop-blur-sm'

/** Top-left label: what is on the stage and where it came from. */
export function SourceChip({ source }: { source: LocalVideoSource | null }) {
  return (
    <div className={cx('area-chip w-full overlay:max-w-[288px]', LABEL_SURFACE)}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cx('size-1.5 rounded-full', source ? 'bg-sage' : 'bg-muted/60')}
        />
        <p className="caps-heading text-fg">{source ? 'Source preview' : 'No source'}</p>
      </div>
      <p className="mt-1.5 truncate text-[11px] leading-[14px] text-muted">
        {source
          ? `${source.name} · ${formatFileSize(source.sizeBytes)}`
          : 'Select an MP4 to begin'}
      </p>
    </div>
  )
}

interface StageNoticeProps {
  label: string
  message: string
  /** An optional button for the next step, shown at the end of the notice. */
  action?: ReactNode
}

/** Top-centre notice: how far to trust what the stage is showing. */
export function StageNotice({ label, message, action }: StageNoticeProps) {
  return (
    <div
      role="note"
      className={cx('area-notice flex flex-wrap items-center gap-x-4 gap-y-2', LABEL_SURFACE)}
    >
      <p className="caps-heading shrink-0 text-fg">{label}</p>
      <p className="min-w-0 flex-1 basis-56 text-[11px] leading-[14px] text-muted">{message}</p>
      {action}
    </div>
  )
}
