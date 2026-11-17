import { cx } from '../../utils/cx'
import type { ScoreComparison } from '../../utils/scoring'
import { CORNER_STYLES } from '../common/cornerStyles'

interface ResultSummaryProps {
  /** The two backend scores compared, or null while either is missing. */
  comparison: ScoreComparison | null
  /** Shown in place of a fighter while nobody can be ranked. Names nobody. */
  pendingLabel: string
  className?: string
}

const NOT_OFFICIAL = 'Not an official fight winner or MMA judging result.'

/**
 * Which fighter has the higher experimental activity score, a tie, or, while
 * the scores are missing, nobody. It ranks the backend's two numbers and
 * nothing else.
 */
export function ResultSummary({ comparison, pendingLabel, className }: ResultSummaryProps) {
  return (
    <section
      aria-label="Experimental activity result"
      className={cx('rounded-lg border border-line bg-panel-raised px-[22px] py-5', className)}
    >
      <p className="caps-heading text-muted">Experimental activity result</p>
      <Outcome comparison={comparison} pendingLabel={pendingLabel} />
    </section>
  )
}

function Outcome({ comparison, pendingLabel }: Omit<ResultSummaryProps, 'className'>) {
  if (!comparison) {
    return (
      <>
        <p className="mt-3 text-lg leading-[22px] font-semibold">
          Higher Experimental Activity Score:
        </p>
        <p className="mt-1.5 text-[28px] leading-[34px] font-semibold text-fg-soft">
          {pendingLabel}
        </p>
        <p className="mt-3 text-[11px] leading-[14px] text-muted">{NOT_OFFICIAL}</p>
        <p className="mt-0.5 text-[11px] leading-[14px] text-muted">
          No fighter is ranked until real scores are available.
        </p>
      </>
    )
  }

  if (comparison.kind === 'tie') {
    return (
      <>
        <p className="mt-3 text-[28px] leading-[34px] font-semibold">
          TIE — Equal Experimental Activity Scores
        </p>
        <p className="mt-1.5 text-xs leading-4 text-fg-soft tabular-nums">
          Both fighters: {comparison.score} experimental points
        </p>
        <p className="mt-3 text-[11px] leading-[14px] text-muted">{NOT_OFFICIAL}</p>
      </>
    )
  }

  const style = CORNER_STYLES[comparison.corner]
  return (
    <>
      <p className="mt-3 text-lg leading-[22px] font-semibold">
        Higher Experimental Activity Score:
      </p>
      <p className={cx('mt-1.5 text-[28px] leading-[34px] font-semibold', style.text)}>
        {style.name} Fighter
      </p>
      <p className="mt-1.5 text-xs leading-4 text-fg-soft tabular-nums">
        {comparison.high} vs {comparison.low} experimental points
      </p>
      <p className="mt-3 text-[11px] leading-[14px] text-muted">{NOT_OFFICIAL}</p>
      <p className="mt-0.5 text-[11px] leading-[14px] text-muted">
        More strong strike-like movement, not more landed strikes or damage.
      </p>
    </>
  )
}
