import type { Corner, FighterTally } from '../../types/dashboard'
import type { CornerState } from '../../types/live'
import { cx } from '../../utils/cx'
import { formatCount } from '../../utils/format'
import { CORNER_STYLES } from '../common/cornerStyles'

interface FighterHudProps {
  corner: Corner
  /** The fighter's detected-event counts, or null while nothing has been analysed. */
  tally: FighterTally | null
  /** Live counts: labelled provisional, because the offline scorecard is the final one. */
  provisional?: boolean
  /** The live identity state of this corner, while a live session runs. */
  trackingState?: CornerState | null
  className?: string
}

const TRACKING_LABELS: Record<CornerState, string> = {
  tracked: 'Tracked',
  uncertain: 'Identity uncertain',
  lost: 'Not tracked',
}

/**
 * The game-style panel in each bottom corner: one fighter's estimated
 * strike-like events. Every number comes from `tally`; with no tally the
 * panel shows dashes.
 *
 * It is a size container (`@container`), so its own width decides the layout:
 * four stats in a row when wide, two by two when narrow (phones).
 */
export function FighterHud({ corner, tally, provisional = false, trackingState = null, className }: FighterHudProps) {
  const style = CORNER_STYLES[corner]
  let status = tally ? 'Analysed' : 'Not tracked'
  if (provisional) status = trackingState ? `Provisional · ${TRACKING_LABELS[trackingState]}` : 'Provisional'

  return (
    <section
      aria-label={`${style.name} fighter`}
      className={cx(
        '@container relative overflow-hidden rounded-lg border bg-hud/92 backdrop-blur-sm',
        style.border,
        className,
      )}
    >
      {/* Identity rail down the left edge and a short accent along the top. */}
      <span aria-hidden className={cx('absolute inset-y-0 left-0 w-[3px]', style.fill)} />
      <span aria-hidden className={cx('absolute top-0 left-0 h-0.5 w-[106px]', style.fill)} />

      <div className="px-4 py-3.5 @min-[300px]:px-5 @min-[300px]:py-4 short:py-3 squat:py-2.5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cx('caps-label', style.text)}>{style.name} corner</p>
            <h2 className="mt-1.5 truncate text-lg leading-6 font-bold @min-[300px]:text-[22px] @min-[300px]:leading-[27px] short:text-lg short:leading-6">
              {style.name} Fighter
            </h2>
          </div>
          <p
            className={cx(
              'hidden pt-0.5 text-right text-[9px] leading-3 font-bold tracking-[0.6px] uppercase @min-[300px]:block',
              tally && trackingState !== 'lost' && trackingState !== 'uncertain' ? style.text : 'text-muted',
            )}
          >
            {status}
          </p>
        </header>

        <hr className="my-3 border-line-strong/50 short:my-2 squat:my-1.5" />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p
            aria-label="Detected strike-like events"
            className={cx(
              'text-[40px] leading-[44px] font-bold tabular-nums @min-[300px]:text-[56px] @min-[300px]:leading-[60px] short:text-[40px] short:leading-[44px]',
              !tally && 'unmeasured',
            )}
          >
            {formatCount(tally?.totalEvents)}
          </p>
          <div>
            <p className={cx('text-[10px] leading-3 font-bold uppercase', style.text)}>Detected</p>
            <p className="mt-1 text-[10px] leading-3 font-medium text-muted uppercase">
              Strike-like events
            </p>
            <p className="mt-1 text-[9px] leading-3 text-muted/80">
              {provisional
                ? 'Live, provisional · not confirmed contact'
                : tally
                  ? 'Estimated · not confirmed contact'
                  : 'No analysis yet'}
            </p>
          </div>
        </div>

        <hr className="my-3 border-line-strong/50 short:my-2 squat:my-1.5" />

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 @min-[300px]:grid-cols-4">
          <HudStat label="Punch-like" value={tally?.punchLike} />
          <HudStat label="Kick-like" value={tally?.kickLike} />
          <HudStat label="Strong" value={tally?.strong} accent={style.text} />
          <HudStat label="Very strong" value={tally?.veryStrong} accent={style.text} />
        </dl>
      </div>
    </section>
  )
}

function HudStat({
  label,
  value,
  accent,
}: {
  label: string
  value: number | undefined
  accent?: string
}) {
  return (
    <div>
      <dt className="text-[8px] leading-[10px] font-semibold tracking-[0.5px] whitespace-nowrap text-muted uppercase">
        {label}
      </dt>
      <dd
        className={cx(
          'mt-1 text-[23px] leading-7 font-semibold tabular-nums short:text-xl short:leading-6',
          // The corner colour is for real counts only.
          value == null ? 'unmeasured' : accent,
        )}
      >
        {formatCount(value)}
      </dd>
    </div>
  )
}
