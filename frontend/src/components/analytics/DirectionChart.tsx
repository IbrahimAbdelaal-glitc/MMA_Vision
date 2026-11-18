import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Fragment, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ClassDirection, LinkedDirectionRow } from '../../services/events'
import { niceTicks } from '../../utils/chart'
import { cx } from '../../utils/cx'
import { formatClock, formatSigned } from '../../utils/format'
import { detectionLabel } from '../../utils/detectionLabel'
import { SERIES_COLORS } from '../charts/series'
import { Swatch } from '../charts/Swatch'
import { Segmented } from '../common/Segmented'
import { CORNER_NAMES, movementLabel } from '../timeline/eventText'

type Measure = 'alignment' | 'approach'

interface MeasureSpec {
  label: string
  description: string
  value: (row: LinkedDirectionRow) => number | null
  average: (group: ClassDirection) => number | null
  format: (value: number | null) => string
  tickDecimals: number
  /** What the two ends of the axis mean. */
  ends: readonly [string, string]
}

/** The two values src/analyze_opponent_direction.py writes for each event. */
const MEASURES: Record<Measure, MeasureSpec> = {
  alignment: {
    label: 'Direction alignment',
    description:
      'How directly the wrist (punch-like) or ankle (kick-like) moved toward the opponent’s torso centre on its way to the peak: the cosine of the angle between the two. +1 is straight toward, 0 sideways, −1 straight away.',
    value: (row) => row.alignment,
    average: (group) => group.alignment,
    format: (value) => formatSigned(value, 3),
    tickDecimals: 1,
    ends: ['Away from the opponent', 'Toward the opponent'],
  },
  approach: {
    label: 'Approach change',
    description:
      'How much closer the wrist or ankle came to the opponent’s torso centre: the median distance 8 to 3 frames before the peak minus the median distance around the peak, in pixels. Negative means it moved away.',
    value: (row) => row.approachChange,
    average: (group) => group.approachChange,
    format: (value) => (value === null ? '—' : `${formatSigned(value, 2)} px`),
    tickDecimals: 0,
    ends: ['Farther from the opponent (px)', 'Closer to the opponent (px)'],
  },
}

interface DirectionChartProps {
  /** The direction stage's rows, each linked to its event; null when they are not available. */
  rows: readonly LinkedDirectionRow[] | null
  byClass: readonly ClassDirection[] | null
  /** Why there is nothing to plot. */
  problem: string | null
  selectedId: string | null
  onSelect: (eventId: string) => void
}

interface Dot {
  /** The event's id, or a stand-in for a row that matches no event. */
  key: string
  eventId: string | null
  row: LinkedDirectionRow
  value: number
  /** 0 to 1 along the axis. */
  fraction: number
  /** Pixels from the top of the class lane. */
  top: number
  lane: number
}

const LANE_HEIGHT = 48
/** Space at each end of the axis so a dot at ±1 stays inside its lane. */
const EDGE = 9

function along(fraction: number): string {
  return `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${fraction})`
}

/**
 * Every event's direction measurement, one row per class, from
 * opponent_direction_analysis.csv. Each dot is one event, placed by its value;
 * Blue sits in the upper half of a row and Red in the lower. The bar in each
 * row and the figure at its end are the class average, computed the way
 * opponent_direction_report.txt computes it.
 *
 * The dots are buttons that select their event. They share one tab stop:
 * Tab reaches the chart, the arrow keys move between dots (left and right
 * along a row, up and down to the nearest dot of the next row), and Enter
 * selects.
 */
export function DirectionChart({ rows, byClass, problem, selectedId, onSelect }: DirectionChartProps) {
  const [measure, setMeasure] = useState<Measure>('alignment')
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const spec = MEASURES[measure]

  // Alignment is a cosine, so its axis is always −1 to +1. Approach change is
  // in pixels; its axis is symmetric around zero and covers the largest value.
  const extent = useMemo(() => {
    if (measure === 'alignment' || !rows) return 1
    const largest = Math.max(0, ...rows.map((row) => Math.abs(row.approachChange ?? 0)))
    return niceTicks(largest, 4).at(-1) ?? 1
  }, [measure, rows])

  const groups = useMemo(() => {
    if (!rows || !byClass) return []
    return byClass.map((summary, lane) => {
      const inClass = rows.filter((row) => row.detectionClass === summary.detectionClass)
      const measured = inClass
        .flatMap((row) => {
          const value = spec.value(row)
          return value === null ? [] : [{ row, value }]
        })
        // Left to right, so the arrow keys move the way the dots read.
        .sort((a, b) => a.value - b.value)
      const perCorner = { blue: 0, red: 0 }
      const dots = measured.map(({ row, value }, position): Dot => {
        const nth = perCorner[row.corner]++
        // Neighbours alternate up and down a little so close values stay apart.
        const nudge = ((nth % 3) - 1) * 4
        return {
          key: row.eventId ?? `${summary.detectionClass}-${position}`,
          eventId: row.eventId,
          row,
          value,
          fraction: Math.min(Math.max((value + extent) / (2 * extent), 0), 1),
          top: (row.corner === 'blue' ? LANE_HEIGHT * 0.32 : LANE_HEIGHT * 0.68) + nudge,
          lane,
        }
      })
      return { summary, total: inClass.length, unmeasured: inClass.length - dots.length, dots }
    })
  }, [rows, byClass, spec, extent])

  const selectable = groups.flatMap((group) => group.dots.filter((dot) => dot.eventId !== null))
  const tabStop =
    selectable.find((dot) => dot.key === focusKey)?.key ??
    selectable.find((dot) => dot.eventId === selectedId)?.key ??
    selectable[0]?.key ??
    null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = selectable.findIndex((dot) => dot.key === tabStop)
    if (current === -1) return
    const from = selectable[current]
    let target: Dot | undefined
    switch (event.key) {
      case 'ArrowRight':
        target = selectable[current + 1]
        break
      case 'ArrowLeft':
        target = selectable[current - 1]
        break
      case 'ArrowDown':
      case 'ArrowUp': {
        const step = event.key === 'ArrowDown' ? 1 : -1
        for (let lane = from.lane + step; lane >= 0 && lane < groups.length; lane += step) {
          const candidates = selectable.filter((dot) => dot.lane === lane)
          if (candidates.length > 0) {
            target = candidates.reduce((best, dot) =>
              Math.abs(dot.value - from.value) < Math.abs(best.value - from.value) ? dot : best,
            )
            break
          }
        }
        break
      }
      case 'Home':
        target = selectable[0]
        break
      case 'End':
        target = selectable.at(-1)
        break
      default:
        return
    }
    event.preventDefault()
    if (target) {
      setFocusKey(target.key)
      buttons.current.get(target.key)?.focus()
    }
  }

  const ticks = [-extent, -extent / 2, 0, extent / 2, extent]

  return (
    <section
      id="opponent-direction-by-event"
      aria-label="Opponent direction by event"
      className="rounded-lg border border-line bg-panel"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4">
        <div className="min-w-0 basis-64">
          <h2 className="text-[17px] leading-[21px] font-semibold">Opponent direction by event</h2>
          <p className="mt-1 text-[11px] leading-[14px] text-muted">{spec.description}</p>
        </div>
        <Segmented
          label="Direction measure"
          value={measure}
          onChange={setMeasure}
          options={[
            { value: 'alignment', label: MEASURES.alignment.label },
            { value: 'approach', label: MEASURES.approach.label },
          ]}
        />
      </header>

      {problem !== null || groups.length === 0 ? (
        <p className="mx-5 mt-4 mb-5 rounded-md border border-dashed border-line-strong px-4 py-6 text-[11px] leading-[14px] text-muted">
          {problem ?? 'opponent_direction_analysis.csv has no events.'}
        </p>
      ) : (
        <div className="px-5 pt-4 pb-1">
          <div
            onKeyDown={onKeyDown}
            className="grid grid-cols-[minmax(68px,auto)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5"
          >
            <span />
            <span />
            <span className="caps-heading text-right text-muted">Average</span>

            {groups.map((group) => (
              <Fragment key={group.summary.detectionClass}>
                <div className="min-w-0">
                  <p className="text-xs leading-4 font-semibold">{detectionLabel(group.summary.detectionClass)}</p>
                  <p className="text-[10px] leading-[13px] text-muted">
                    {group.total} event{group.total === 1 ? '' : 's'}
                    {group.unmeasured > 0 && ` · ${group.unmeasured} not measured`}
                  </p>
                </div>

                <div className="relative rounded-sm bg-panel-raised/50" style={{ height: LANE_HEIGHT }}>
                  {ticks.map((tick) => (
                    <span
                      key={tick}
                      aria-hidden
                      className={cx('absolute inset-y-0 w-px', tick === 0 ? 'bg-line-strong' : 'bg-line/60')}
                      style={{ left: along((tick + extent) / (2 * extent)) }}
                    />
                  ))}
                  {spec.average(group.summary) !== null && (
                    <span
                      aria-hidden
                      className="absolute top-1.5 bottom-1.5 w-[3px] -translate-x-1/2 rounded-full bg-fg"
                      style={{
                        left: along(
                          Math.min(Math.max((spec.average(group.summary)! + extent) / (2 * extent), 0), 1),
                        ),
                      }}
                    />
                  )}

                  {group.dots.map((dot) => {
                    const style = { left: along(dot.fraction), top: dot.top }
                    const mark = (
                      <span
                        className={cx(
                          'block rounded-full ring-2 ring-panel',
                          dot.eventId !== null && dot.eventId === selectedId
                            ? 'size-3 outline-2 outline-offset-2 outline-fg'
                            : 'size-2.5',
                        )}
                        style={{ backgroundColor: SERIES_COLORS[dot.row.corner] }}
                      />
                    )
                    if (dot.eventId === null) {
                      return (
                        <span key={dot.key} aria-hidden className="absolute -translate-x-1/2 -translate-y-1/2" style={style}>
                          {mark}
                        </span>
                      )
                    }
                    const eventId = dot.eventId
                    return (
                      <button
                        key={dot.key}
                        ref={(element) => {
                          if (element) buttons.current.set(dot.key, element)
                          else buttons.current.delete(dot.key)
                        }}
                        type="button"
                        tabIndex={dot.key === tabStop ? 0 : -1}
                        aria-label={`${CORNER_NAMES[dot.row.corner]} ${dot.row.eventType} at ${formatClock(dot.row.peakTime)}, ${detectionLabel(dot.row.detectionClass)}, ${spec.label.toLowerCase()} ${spec.format(dot.value)}`}
                        aria-current={eventId === selectedId ? 'true' : undefined}
                        onClick={() => onSelect(eventId)}
                        onFocus={() => {
                          setFocusKey(dot.key)
                          setActiveKey(dot.key)
                        }}
                        onBlur={() => setActiveKey(null)}
                        onPointerEnter={() => setActiveKey(dot.key)}
                        onPointerLeave={() => setActiveKey(null)}
                        className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full focus-visible:outline-offset-0"
                        style={style}
                      >
                        {mark}
                      </button>
                    )
                  })}

                  {group.dots
                    .filter((dot) => dot.key === activeKey)
                    .map((dot) => (
                      <DotTooltip key={dot.key} dot={dot} spec={spec} />
                    ))}
                </div>

                <p className="text-right text-xs leading-4 font-semibold tabular-nums">
                  {spec.format(spec.average(group.summary))}
                </p>
              </Fragment>
            ))}

            <span />
            <div className="relative h-4" aria-hidden>
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute top-0.5 -translate-x-1/2 text-[9px] leading-[11px] text-muted tabular-nums"
                  style={{ left: along((tick + extent) / (2 * extent)) }}
                >
                  {formatSigned(tick, spec.tickDecimals)}
                </span>
              ))}
            </div>
            <span />

            <span />
            <div className="flex justify-between gap-3 text-[10px] leading-[13px] text-muted">
              <span className="inline-flex items-center gap-1">
                <ArrowLeft size={11} aria-hidden />
                {spec.ends[0]}
              </span>
              <span className="inline-flex items-center gap-1 text-right">
                {spec.ends[1]}
                <ArrowRight size={11} aria-hidden />
              </span>
            </div>
            <span />
          </div>
        </div>
      )}

      <footer className="mt-3 space-y-1.5 border-t border-line px-5 py-3 text-[10px] leading-[13px] text-muted">
        <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-fg-soft">
          <li className="inline-flex items-center gap-1.5">
            <Swatch color={SERIES_COLORS.blue} />
            Blue event
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Swatch color={SERIES_COLORS.red} />
            Red event
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-[3px] rounded-full bg-fg" />
            Class average
          </li>
        </ul>
        <p>
          Each dot is one event of opponent_direction_analysis.csv. The averages are computed from
          that file the way opponent_direction_report.txt computes them, leaving out events without a
          value. Direction says where a limb moved, not whether it landed.
        </p>
      </footer>
    </section>
  )
}

function DotTooltip({ dot, spec }: { dot: Dot; spec: MeasureSpec }) {
  // Kept inside the panel at both ends of the axis.
  const shift = dot.fraction < 0.2 ? '-12%' : dot.fraction > 0.8 ? '-88%' : '-50%'
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-md border border-line bg-panel-raised px-2.5 py-1.5 text-[10px] leading-[13px] text-fg-soft shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
      style={{ left: along(dot.fraction), top: dot.top - 12, transform: `translate(${shift}, -100%)` }}
    >
      <p className="font-semibold text-fg">
        {CORNER_NAMES[dot.row.corner]} · {movementLabel(dot.row)}
      </p>
      <p className="tabular-nums">Peak {formatClock(dot.row.peakTime)}</p>
      <p className="tabular-nums">
        {spec.label}: {spec.format(dot.value)}
      </p>
    </div>
  )
}
