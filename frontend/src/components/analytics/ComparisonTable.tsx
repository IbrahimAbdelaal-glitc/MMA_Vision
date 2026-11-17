import type { Scorecard, ScorecardRow } from '../../types/api'
import type { Corner, DetectionClass } from '../../types/dashboard'
import { cx } from '../../utils/cx'
import type { UnscoredCounts } from '../dashboard/matchEndedState'

/** The scored rows, straight from experimental_scorecard.csv. */
const FINAL_ROWS: ReadonlyArray<readonly [string, keyof ScorecardRow]> = [
  ['Total final events', 'totalEvents'],
  ['Punch-like events', 'punchLike'],
  ['Kick-like events', 'kickLike'],
  ['Strong events', 'strong'],
  ['Very Strong events', 'veryStrong'],
]

/** The unscored classes, from classified_strike_candidates.csv. */
const UNSCORED_ROWS: ReadonlyArray<readonly [string, DetectionClass]> = [
  ['Review events', 'Review'],
  ['Low events', 'Low'],
]

const CORNERS: readonly Corner[] = ['blue', 'red']

interface ComparisonTableProps {
  scorecard: Scorecard | null
  unscored: UnscoredCounts
}

/**
 * Blue against Red, row by row. Every count is the backend's own; a value it
 * did not provide, or that could not be read, is a dash.
 */
export function ComparisonTable({ scorecard, unscored }: ComparisonTableProps) {
  return (
    <section
      aria-label="Final event comparison"
      className="overflow-hidden rounded-lg border border-line bg-panel"
    >
      <header className="px-5 pt-4 pb-3">
        <h2 className="text-[17px] leading-[21px] font-semibold">Final event comparison</h2>
        <p className="mt-1 text-[11px] leading-[14px] text-muted">
          Backend counts of strike-like movement candidates
        </p>
      </header>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-panel-raised text-[9px] leading-[11px] tracking-[0.6px] uppercase">
            <th className="px-7 py-2 font-semibold text-muted">Detected events</th>
            <th className="w-20 px-3 py-2 text-right font-semibold text-corner-blue">Blue</th>
            <th className="w-24 py-2 pr-7 pl-3 text-right font-semibold text-corner-red">Red</th>
          </tr>
        </thead>
        <tbody>
          {FINAL_ROWS.map(([label, field]) => (
            <CountRow
              key={label}
              label={label}
              values={CORNERS.map((corner) => scorecard?.[corner]?.[field] ?? null)}
            />
          ))}
          <tr className="border-t border-line bg-panel-raised/60">
            <th
              scope="colgroup"
              colSpan={3}
              className="px-7 py-1.5 text-[9px] leading-[11px] font-semibold tracking-[0.6px] text-muted uppercase"
            >
              Not scored · below the final threshold
            </th>
          </tr>
          {UNSCORED_ROWS.map(([label, detectionClass]) => (
            <CountRow
              key={label}
              label={label}
              values={CORNERS.map((corner) => unscored.counts?.[corner][detectionClass] ?? null)}
            />
          ))}
        </tbody>
      </table>

      <div className="space-y-1 border-t border-line px-7 py-3 text-[10px] leading-[13px] text-muted">
        {unscored.note && (
          <p className={cx(!unscored.counts && 'text-warn')}>
            {unscored.counts ? unscored.note : `Review and Low counts unavailable: ${unscored.note}`}
          </p>
        )}
        <p>
          Review and Low events fall below the final threshold (kinematic score 65) and add no
          points. They come from classified_strike_candidates.csv.
        </p>
      </div>
    </section>
  )
}

function CountRow({ label, values }: { label: string; values: Array<number | null> }) {
  return (
    <tr className="border-t border-line/70 text-xs leading-4">
      <th scope="row" className="px-7 py-[7px] font-semibold">
        {label}
      </th>
      {values.map((value, index) => (
        <td
          key={CORNERS[index]}
          className={cx(
            'text-right tabular-nums',
            index === 0 ? 'px-3' : 'pr-7 pl-3',
            value === null ? 'unmeasured' : 'text-fg',
          )}
        >
          {value === null ? '—' : value}
        </td>
      ))}
    </tr>
  )
}
