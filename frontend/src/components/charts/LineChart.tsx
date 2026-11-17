import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useElementWidth } from '../../hooks/useElementWidth'
import { formatSecondsTick, highestValue, linePath, nearestIndex, niceTicks } from '../../utils/chart'
import { formatClock, formatGrouped } from '../../utils/format'
import { Playhead } from './Playhead'
import { Swatch } from './Swatch'

export interface LineSeries {
  id: string
  /** The legend and reading name, such as "Blue". */
  label: string
  color: string
  /** One value per time sample; null where the backend has none. */
  values: ReadonlyArray<number | null>
}

interface LineChartProps {
  /** What the chart shows, for screen readers: "Fighter movement speed". */
  title: string
  /** Seconds from the start of the video, ascending, one per frame. */
  time: readonly number[]
  series: readonly LineSeries[]
  unit: string
  /** Decimals in the frame reading. */
  decimals: number
  /** The replay, when one is loaded: its position is drawn on the chart. */
  video: HTMLVideoElement | null
}

const HEIGHT = 232
const MARGIN = { top: 22, right: 14, bottom: 24, left: 48 }
/** Shift+arrow and Page Up/Down move the reading by this much. */
const JUMP_SECONDS = 1

/**
 * A time-series line chart drawn from the backend's per-frame values, at the
 * container's real width. It plots what it is given: a missing value breaks
 * the line, and nothing is smoothed here (the backend already smoothed the
 * series it charts). One y axis, from zero, for every series.
 *
 * Reading values: hover or touch the plot, or focus it and use the arrow keys
 * (one frame), Shift+arrows or Page Up/Down (one second), Home and End. The
 * reading line above the plot is a live region, so screen readers hear it.
 */
export function LineChart({ title, time, series, unit, decimals, video }: LineChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>(720)
  const [index, setIndex] = useState<number | null>(null)

  const count = time.length
  const start = time[0] ?? 0
  const end = time.at(-1) ?? 0
  const span = end - start || 1
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 1)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const bottom = MARGIN.top + plotHeight

  const yTicks = useMemo(() => niceTicks(highestValue(series.map((line) => line.values)) ?? 0), [series])
  const yMax = yTicks[yTicks.length - 1]
  const yStep = yTicks[1] - yTicks[0]
  const xTicks = niceTicks(end, Math.min(8, Math.max(2, Math.floor(plotWidth / 90)))).filter(
    (tick) => tick >= start && tick <= end + 1e-9,
  )

  const toX = (seconds: number) => MARGIN.left + ((seconds - start) / span) * plotWidth
  const toY = (value: number) => bottom - (value / yMax) * plotHeight

  // The paths are the expensive part (hundreds of points per series), so they
  // are rebuilt only when the data or the size changes, never on hover.
  const paths = useMemo(
    () =>
      series.map((line) =>
        linePath(
          line.values.map((value, frame) =>
            value === null
              ? null
              : [
                  MARGIN.left + ((time[frame] - start) / span) * plotWidth,
                  bottom - (value / yMax) * plotHeight,
                ],
          ),
        ),
      ),
    [series, time, start, span, plotWidth, bottom, yMax, plotHeight],
  )

  const readAt = (event: PointerEvent<SVGSVGElement>) => {
    if (count === 0) return
    const offset = event.clientX - event.currentTarget.getBoundingClientRect().left
    setIndex(nearestIndex(time, start + ((offset - MARGIN.left) / plotWidth) * span))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return
    const last = count - 1
    const from = index ?? 0
    const jump = (direction: 1 | -1) => nearestIndex(time, time[from] + direction * JUMP_SECONDS)
    let next: number | null
    switch (event.key) {
      case 'ArrowRight':
        next = event.shiftKey ? jump(1) : index === null ? 0 : Math.min(index + 1, last)
        break
      case 'ArrowLeft':
        next = event.shiftKey ? jump(-1) : index === null ? last : Math.max(index - 1, 0)
        break
      case 'PageDown':
        next = jump(1)
        break
      case 'PageUp':
        next = jump(-1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'Escape':
        next = null
        break
      default:
        return
    }
    event.preventDefault()
    setIndex(next)
  }

  const tickDecimals = yStep >= 1 ? 0 : yStep >= 0.1 ? 1 : 2
  const crosshair = index === null ? null : toX(time[index])
  const names = series.map((line) => line.label).join(' and ')

  return (
    <div>
      <p
        role="status"
        aria-label="Chart reading"
        aria-atomic="true"
        className="flex min-h-[18px] flex-wrap items-center gap-x-4 gap-y-1 text-[11px] leading-[14px]"
      >
        {index === null ? (
          <span className="text-muted">
            Hover the chart, or focus it and use the arrow keys, to read each frame.
          </span>
        ) : (
          <>
            <span className="font-semibold text-fg tabular-nums">{formatClock(time[index])}</span>
            {series.map((line) => {
              const value = line.values[index]
              return (
                <span key={line.id} className="inline-flex items-center gap-1.5 text-fg-soft tabular-nums">
                  <Swatch color={line.color} />
                  {value === null
                    ? `${line.label}: no value in this frame`
                    : `${line.label} ${formatGrouped(value, decimals)} ${unit}`}
                </span>
              )
            })}
          </>
        )}
      </p>

      <div
        ref={ref}
        role="img"
        tabIndex={0}
        aria-label={`${title}: ${names}, in ${unit}, from ${formatClock(start)} to ${formatClock(end)}. Use the arrow keys to read each frame.`}
        onKeyDown={onKeyDown}
        onBlur={() => setIndex(null)}
        className="mt-2 rounded-md focus-visible:outline-offset-4"
      >
        <svg
          width={width}
          height={HEIGHT}
          aria-hidden
          className="block touch-pan-y"
          onPointerMove={readAt}
          onPointerDown={readAt}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setIndex(null)
          }}
        >
          <text x={MARGIN.left - 8} y={11} textAnchor="end" className="fill-muted text-[9px]">
            {unit}
          </text>

          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={toY(tick)}
                y2={toY(tick)}
                stroke={tick === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'}
                shapeRendering="crispEdges"
              />
              <text
                x={MARGIN.left - 8}
                y={toY(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted text-[9px] tabular-nums"
              >
                {formatGrouped(tick, tickDecimals)}
              </text>
            </g>
          ))}

          {xTicks.map((tick) => (
            <text
              key={tick}
              x={toX(tick)}
              y={HEIGHT - 6}
              textAnchor="middle"
              className="fill-muted text-[9px] tabular-nums"
            >
              {formatSecondsTick(tick, end)}
            </text>
          ))}

          {series.map((line, position) => (
            <path
              key={line.id}
              d={paths[position]}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {video && (
            <Playhead
              video={video}
              x={(seconds) => (seconds >= start && seconds <= end ? toX(seconds) : null)}
              top={MARGIN.top}
              bottom={bottom}
            />
          )}

          {crosshair !== null && index !== null && (
            <g pointerEvents="none">
              <line
                x1={crosshair}
                x2={crosshair}
                y1={MARGIN.top}
                y2={bottom}
                stroke="var(--color-fg-soft)"
                strokeOpacity={0.55}
              />
              {series.map((line) => {
                const value = line.values[index]
                return value === null ? null : (
                  <circle
                    key={line.id}
                    cx={crosshair}
                    cy={toY(value)}
                    r={4}
                    fill={line.color}
                    stroke="var(--color-panel)"
                    strokeWidth={2}
                  />
                )
              })}
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
