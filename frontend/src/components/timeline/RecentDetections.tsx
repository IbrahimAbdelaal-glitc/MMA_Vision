import type { StrikeEvent, StrikeType } from '../../types/dashboard'
import { cx } from '../../utils/cx'
import { formatClock, formatMeasure } from '../../utils/format'
import { detectionLabel } from '../../utils/detectionLabel'
import { CORNER_STYLES } from '../common/cornerStyles'

const TYPE_LABELS: Record<StrikeType, string> = {
  'punch-like': 'Punch-like',
  'kick-like': 'Kick-like',
}

// Cells are tighter on phones so all five columns fit without clipping.
const CELL_X = 'px-2 sm:px-3.5'
const HEADER_CELL = cx(CELL_X, 'pt-3 pb-1.5 font-semibold')
const BODY_CELL = cx(CELL_X, 'py-1.5')

interface RecentDetectionsProps {
  events: StrikeEvent[]
  /** How many of the most recent events to show. */
  limit?: number
}

/** The latest estimated strike-like events, newest first, each with its timestamp. */
export function RecentDetections({ events, limit = 3 }: RecentDetectionsProps) {
  // Copy before sorting: sort() reorders in place and this array belongs to the caller.
  const rows = [...events].sort((a, b) => b.timeSeconds - a.timeSeconds).slice(0, limit)

  return (
    <div className="w-full max-w-[552px] overflow-hidden rounded-lg border border-line-strong bg-hud/92 backdrop-blur-sm">
      <table aria-label="Recent detections" className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[8px] leading-[10px] tracking-[0.8px] text-muted uppercase">
            <th colSpan={2} className={HEADER_CELL}>
              Recent detections
            </th>
            <th className={HEADER_CELL}>Estimated type</th>
            <th className={HEADER_CELL}>Classification</th>
            <th
              className={cx(HEADER_CELL, 'text-right')}
              title="Kinematic score: a heuristic ranking out of 100, not a probability"
            >
              Heuristic score
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className={cx(CELL_X, 'pt-1 pb-3 text-[11px] leading-[14px] text-muted')}>
                No detections yet. Each event is listed here with its timestamp as it is detected.
              </td>
            </tr>
          ) : (
            rows.map((event) => {
              const style = CORNER_STYLES[event.corner]
              return (
                <tr key={event.id} className="border-t border-line/60 text-[11px] leading-[14px]">
                  <td className={cx(BODY_CELL, 'font-medium text-fg-soft tabular-nums')}>
                    {formatClock(event.timeSeconds)}
                  </td>
                  <td className={BODY_CELL}>
                    <span className="inline-flex items-center gap-1.5 text-[9px] leading-[11px] font-bold uppercase">
                      <span aria-hidden className={cx('size-1.5 rounded-full', style.fill)} />
                      <span className={style.text}>{style.name}</span>
                    </span>
                  </td>
                  <td className={BODY_CELL}>{TYPE_LABELS[event.type]}</td>
                  <td className={cx(BODY_CELL, event.detectionClass === null && 'text-muted')}>
                    {event.detectionClass ? detectionLabel(event.detectionClass) : 'Unscored (warm-up)'}
                  </td>
                  <td className={cx(BODY_CELL, 'text-right text-muted tabular-nums')}>
                    {formatMeasure(event.kinematicScore, 1)}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
