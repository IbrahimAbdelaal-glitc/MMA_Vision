import type { MouseEvent } from 'react'
import { useElementWidth } from '../../hooks/useElementWidth'
import type { CandidateEvent } from '../../types/api'
import type { Corner } from '../../types/dashboard'
import { formatSecondsTick, niceTicks } from '../../utils/chart'
import { formatClock } from '../../utils/format'
import { pointsFor } from '../../utils/scoring'
import { seekTo } from '../../utils/seek'
import { Playhead } from '../charts/Playhead'
import { SERIES_COLORS } from '../charts/series'
import { CORNER_NAMES } from './eventText'

interface EventStripProps {
  events: readonly CandidateEvent[]
  /** The end of the time axis, in seconds: the last analysed frame. */
  end: number
  selectedId: string | null
  onSelect: (event: CandidateEvent) => void
  /** The replay, when one is loaded: its position is drawn, and a click on an empty spot seeks it there. */
  video: HTMLVideoElement | null
}

const LANES: readonly Corner[] = ['blue', 'red']
const LABEL_WIDTH = 40
const RIGHT_PAD = 8
const LANE_HEIGHT = 24
const BAR_HEIGHT = 12
const AXIS_HEIGHT = 18
const MIN_BAR_WIDTH = 3

/**
 * Every listed event on one time axis, one lane per fighter. A bar runs from
 * the event's start to its end time, so its width is the movement's measured
 * duration. Scored events are solid; Review and Low events are faint.
 *
 * The strip is a pointer shortcut. Everything it does can also be done from
 * the table under it, which is where keyboard and screen-reader users select
 * events, so the strip is one labelled image rather than 55 more tab stops.
 */
export function EventStrip({ events, end, selectedId, onSelect, video }: EventStripProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>(720)
  const plotWidth = Math.max(width - LABEL_WIDTH - RIGHT_PAD, 1)
  const lanesHeight = LANES.length * LANE_HEIGHT
  const height = lanesHeight + AXIS_HEIGHT
  const toX = (seconds: number) =>
    LABEL_WIDTH + (Math.min(Math.max(seconds, 0), end) / end) * plotWidth
  const ticks = niceTicks(end, Math.min(8, Math.max(2, Math.floor(plotWidth / 90)))).filter(
    (tick) => tick <= end + 1e-9,
  )

  const onClick = (event: MouseEvent<SVGSVGElement>) => {
    const bar = (event.target as Element).closest('[data-event-id]')
    if (bar) {
      const chosen = events.find((candidate) => candidate.id === bar.getAttribute('data-event-id'))
      if (chosen) onSelect(chosen)
      return
    }
    if (!video) return
    const offset = event.clientX - event.currentTarget.getBoundingClientRect().left - LABEL_WIDTH
    if (offset >= 0 && offset <= plotWidth) seekTo(video, (offset / plotWidth) * end)
  }

  const counts = LANES.map(
    (corner) => `${events.filter((event) => event.corner === corner).length} ${CORNER_NAMES[corner]}`,
  )

  return (
    <div
      ref={ref}
      role="img"
      // Clock times, like the table's: an axis tick format would read the
      // end of the run aloud as "14.9833333333 s".
      aria-label={`Timeline of ${events.length} events, ${counts.join(' and ')}, from ${formatClock(0)} to ${formatClock(end)}.`}
    >
      <svg width={width} height={height} onClick={onClick} className="block">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={toX(tick)}
              x2={toX(tick)}
              y1={0}
              y2={lanesHeight}
              stroke="var(--color-line)"
              strokeOpacity={0.6}
              shapeRendering="crispEdges"
            />
            <text
              x={toX(tick)}
              y={height - 5}
              textAnchor="middle"
              className="fill-muted text-[9px]"
            >
              {formatSecondsTick(tick, end)}
            </text>
          </g>
        ))}

        {LANES.map((corner, lane) => {
          const middle = lane * LANE_HEIGHT + LANE_HEIGHT / 2
          return (
            <g key={corner}>
              <text x={0} y={middle} dy="0.32em" className="fill-muted text-[10px] font-semibold">
                {CORNER_NAMES[corner]}
              </text>
              <line
                x1={LABEL_WIDTH}
                x2={LABEL_WIDTH + plotWidth}
                y1={middle}
                y2={middle}
                stroke="var(--color-line)"
                shapeRendering="crispEdges"
              />
            </g>
          )
        })}

        {events.map((event) => {
          const start = event.startTime ?? event.peakTime
          if (start === null) return null
          const stop = event.endTime ?? event.peakTime ?? start
          const x1 = toX(start)
          const barWidth = Math.max(toX(stop) - x1, MIN_BAR_WIDTH)
          const laneTop = LANES.indexOf(event.corner) * LANE_HEIGHT
          const selected = event.id === selectedId
          return (
            <g key={event.id} data-event-id={event.id} className="cursor-pointer">
              {/* A taller, wider invisible target than the bar itself. */}
              <rect x={x1 - 3} y={laneTop} width={barWidth + 6} height={LANE_HEIGHT} fill="transparent" />
              <rect
                x={x1}
                y={laneTop + (LANE_HEIGHT - BAR_HEIGHT) / 2}
                width={barWidth}
                height={BAR_HEIGHT}
                rx={2}
                fill={SERIES_COLORS[event.corner]}
                fillOpacity={pointsFor(event.detectionClass) > 0 ? 1 : 0.4}
                stroke={selected ? 'var(--color-fg)' : 'var(--color-panel)'}
                strokeWidth={2}
              />
            </g>
          )
        })}

        {video && (
          <Playhead
            video={video}
            x={(seconds) => (seconds >= 0 && seconds <= end ? toX(seconds) : null)}
            top={0}
            bottom={lanesHeight}
          />
        )}
      </svg>
    </div>
  )
}
