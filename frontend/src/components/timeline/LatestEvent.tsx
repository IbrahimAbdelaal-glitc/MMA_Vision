import { Zap } from 'lucide-react'
import type { StrikeEvent, StrikeType } from '../../types/dashboard'
import { cx } from '../../utils/cx'
import { formatClock, formatMeasure } from '../../utils/format'
import { CORNER_STYLES } from '../common/cornerStyles'

const TYPE_TITLES: Record<StrikeType, string> = {
  'punch-like': 'Punch-like motion',
  'kick-like': 'Kick-like motion',
}

/**
 * The most recent estimated strike-like event: who, what, when, and how it was
 * classified. The kinematic score is shown as what it is, a heuristic ranking
 * out of 100, alongside the pose model's keypoint confidence. Neither is a
 * probability, so no percentage appears here.
 */
export function LatestEvent({ event }: { event: StrikeEvent | null }) {
  const style = event ? CORNER_STYLES[event.corner] : null

  return (
    <section
      aria-label="Latest detected event"
      className={cx(
        'relative flex w-full max-w-[468px] items-center gap-3.5 overflow-hidden rounded-lg border bg-hud/92 px-3.5 py-3 backdrop-blur-sm short:py-2.5',
        style ? style.border : 'border-line-strong',
      )}
    >
      {event && style ? (
        <>
          <span aria-hidden className={cx('absolute inset-y-0 left-0 w-[3px]', style.fill)} />
          <span className={cx('grid size-9 shrink-0 place-items-center rounded-md', style.tile)}>
            <Zap size={16} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cx('caps-heading', style.text)}>
              {style.name} / strike-like event{event.provisional ? ' · provisional' : ''}
            </p>
            <p className="mt-1 text-base leading-[19px] font-semibold">{TYPE_TITLES[event.type]}</p>
            <p className="mt-1 truncate text-[9px] leading-[11px] text-muted">
              {event.kinematicScore === null
                ? 'Unscored: ranking warm-up (first 4 candidates on this limb)'
                : `Kinematic score ${formatMeasure(event.kinematicScore, 1)} (heuristic)`}{' '}
              · keypoint confidence {formatMeasure(event.keypointConfidence, 2)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] leading-[13px] font-medium text-fg-soft tabular-nums">
              {formatClock(event.timeSeconds)}
            </p>
            <p className="mt-1.5 inline-block rounded bg-control px-2.5 py-1 text-[9px] leading-[11px] font-bold tracking-[0.6px] uppercase">
              {event.detectionClass ?? 'Unscored'}
            </p>
          </div>
        </>
      ) : (
        <>
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-control/60 text-muted">
            <Zap size={16} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] leading-4 font-semibold text-fg-soft">
              No strike-like events detected
            </p>
            <p className="mt-1 text-[10px] leading-[13px] text-muted">
              The latest detection appears here with its timestamp.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
