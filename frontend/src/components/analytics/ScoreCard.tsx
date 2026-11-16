import type { Corner } from '../../types/dashboard'
import { cx } from '../../utils/cx'
import { CORNER_STYLES } from '../common/cornerStyles'

interface ScoreCardProps {
  corner: Corner
  /** The fighter's experimental activity score from the completed job, or null. */
  score: number | null
  /** Where the score came from, or why there is none. */
  caption: string
  className?: string
}

/** One fighter's final experimental activity score. */
export function ScoreCard({ corner, score, caption, className }: ScoreCardProps) {
  const style = CORNER_STYLES[corner]

  return (
    <section
      aria-label={`${style.name} fighter final score`}
      className={cx('relative overflow-hidden rounded-lg border px-5 py-4', style.card, className)}
    >
      <span aria-hidden className={cx('absolute inset-y-0 left-0 w-[3px]', style.fill)} />

      <p className={cx('caps-label', style.text)}>{style.name} corner</p>
      <h2 className="mt-1.5 text-[22px] leading-[27px] font-bold">{style.name} Fighter</h2>

      <div className="mt-1 flex items-center gap-4">
        <p
          className={cx(
            'text-[58px] leading-[70px] font-bold tabular-nums',
            score == null && 'unmeasured',
          )}
        >
          {score == null ? '—' : score}
        </p>
        <div>
          <p className="caps-heading text-fg">Experimental</p>
          <p className="caps-heading mt-1 text-fg">Activity score</p>
          <p className="mt-1.5 text-[10px] leading-[13px] text-muted">{caption}</p>
        </div>
      </div>
    </section>
  )
}
