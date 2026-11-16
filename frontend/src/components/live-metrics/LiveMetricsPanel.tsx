import type { LiveMetrics } from '../../types/dashboard'
import { cx } from '../../utils/cx'
import { formatMeasure } from '../../utils/format'

/** The pipeline records 12 body joints per fighter (shoulders to ankles). */
const JOINTS_PER_FIGHTER = 12
const FIGHTERS = 2

function outOf(value: number | null | undefined, total: number): string {
  return value == null ? '—' : `${value} / ${total}`
}

/** A measured value keeps its own colour; an unmeasured one is drawn quieter. */
function tone(value: number | null | undefined, measuredClass: string): string {
  return value == null ? 'unmeasured' : measuredClass
}

/**
 * Measurements taken from the video. Units are the ones the system really
 * measures: pixels, share of the frame diagonal, pixels per second, and the
 * pose model's own keypoint confidence. There are no metres (the camera is not
 * calibrated) and no probabilities. Anything not measured shows a dash.
 */
export function LiveMetricsPanel({ metrics }: { metrics: LiveMetrics | null }) {
  const confidence = metrics?.keypointConfidence ?? null

  return (
    <section
      aria-label="Live metrics"
      className="rounded-lg border border-line-strong bg-hud/92 px-4 py-4 backdrop-blur-sm short:py-3"
    >
      <header className="flex items-center justify-between">
        <h2 className="caps-heading text-fg">Live metrics</h2>
        <span
          aria-hidden
          className={cx('size-1.5 rounded-full', metrics ? 'bg-ok' : 'bg-muted/50')}
        />
      </header>

      <p className="mt-4 text-[9px] leading-[11px] font-medium text-muted uppercase short:mt-3">
        Distance between fighters
      </p>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <p
          className={cx(
            'text-4xl leading-[44px] font-semibold tabular-nums short:text-[28px] short:leading-8',
            tone(metrics?.distancePx, 'text-fg'),
          )}
        >
          {formatMeasure(metrics?.distancePx, 0)}{' '}
          <span className="text-[13px] font-medium text-muted">px</span>
        </p>
        <p className="text-right text-[10px] leading-3 text-muted">
          <span
            className={cx(
              'font-semibold tabular-nums',
              tone(metrics?.distancePercentDiagonal, 'text-fg-soft'),
            )}
          >
            {formatMeasure(metrics?.distancePercentDiagonal, 1)}
          </span>{' '}
          % of frame diagonal
        </p>
      </div>

      <hr className="my-3 border-line-strong/50 short:my-2.5" />

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] leading-[13px] text-fg-soft">Movement speed</p>
          <p className="mt-0.5 text-[9px] leading-[11px] text-muted">px/s, box centre</p>
        </div>
        <div className="flex gap-3 text-xs leading-4 font-semibold tabular-nums">
          <p className={tone(metrics?.blueSpeedPxPerSecond, 'text-corner-blue')}>
            <span className="sr-only">Blue movement speed</span>
            {formatMeasure(metrics?.blueSpeedPxPerSecond, 0)}
          </p>
          <p className={tone(metrics?.redSpeedPxPerSecond, 'text-corner-red')}>
            <span className="sr-only">Red movement speed</span>
            {formatMeasure(metrics?.redSpeedPxPerSecond, 0)}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] leading-[13px] text-fg-soft">Strike activity</p>
          <p className="mt-0.5 text-[9px] leading-[11px] text-muted">estimated events / min</p>
        </div>
        <p
          className={cx(
            'text-xs leading-4 font-semibold tabular-nums',
            tone(metrics?.strikeEventsPerMinute, 'text-fg'),
          )}
        >
          {formatMeasure(metrics?.strikeEventsPerMinute, 0)}
        </p>
      </div>

      <hr className="my-3 border-line-strong/50 short:my-2.5" />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-[13px] text-fg-soft">Pose keypoint confidence</p>
        <p className={cx('text-xs leading-4 font-semibold tabular-nums', tone(confidence, 'text-ok'))}>
          {formatMeasure(confidence, 2)}
        </p>
      </div>
      <div aria-hidden className="mt-2 h-0.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-ok"
          style={{ width: `${Math.min(Math.max(confidence ?? 0, 0), 1) * 100}%` }}
        />
      </div>

      <dl className="mt-3 space-y-1.5 text-[10px] leading-3">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Fighters tracked</dt>
          <dd
            className={cx('font-semibold tabular-nums', tone(metrics?.fightersTracked, 'text-fg'))}
          >
            {outOf(metrics?.fightersTracked, FIGHTERS)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Keypoints tracked</dt>
          <dd
            className={cx('font-semibold tabular-nums', tone(metrics?.keypointsTracked, 'text-fg'))}
          >
            {outOf(metrics?.keypointsTracked, JOINTS_PER_FIGHTER * FIGHTERS)}
          </dd>
        </div>
      </dl>

      {!metrics && (
        <p className="mt-3 text-[8px] leading-[10px] font-semibold tracking-[0.6px] text-muted/80 uppercase short:mt-2.5 squat:hidden">
          Nothing measured yet
        </p>
      )}
    </section>
  )
}
