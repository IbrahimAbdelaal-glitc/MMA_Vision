/*
 * Small, pure helpers for the dashboard's SVG charts. They place values; they
 * never smooth, interpolate or invent one. A missing value breaks a line.
 */

const STEP_FACTORS = [1, 2, 2.5, 5, 10]

/** Removes floating-point noise such as 0.6000000000000001. */
function tidy(value: number): number {
  return Number(value.toPrecision(12))
}

/**
 * Axis ticks from zero that cover `max`, in about `target` round steps of
 * 1, 2, 2.5 or 5 times a power of ten.
 */
export function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0, 1]
  const raw = max / target
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = STEP_FACTORS.map((factor) => factor * magnitude).find((candidate) => candidate >= raw)!
  const count = Math.ceil(max / step - 1e-9)
  return Array.from({ length: count + 1 }, (_, index) => tidy(index * step))
}

/**
 * A label for a tick on a time axis that ends at `axisEnd` seconds. A short
 * axis reads in seconds ("2.5 s"); an axis of a minute or more reads every
 * tick as minutes and seconds ("1:30"), so one axis never mixes the two.
 */
export function formatSecondsTick(seconds: number, axisEnd: number): string {
  if (axisEnd < 60) return `${tidy(seconds)} s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The largest measured value across every series, or null when nothing was measured. */
export function highestValue(series: ReadonlyArray<ReadonlyArray<number | null>>): number | null {
  let highest: number | null = null
  for (const values of series) {
    for (const value of values) {
      if (value !== null && (highest === null || value > highest)) highest = value
    }
  }
  return highest
}

function pixel(value: number): string {
  return `${Math.round(value * 10) / 10}`
}

/**
 * An SVG path through points already placed in pixels. null breaks the line,
 * so a gap in the data shows as a gap. A point alone between two gaps is drawn
 * as a zero-length segment, which a round line cap renders as a dot.
 */
export function linePath(points: ReadonlyArray<readonly [number, number] | null>): string {
  let path = ''
  let run = 0
  for (const point of points) {
    if (point === null) {
      if (run === 1) path += 'l0,0'
      run = 0
      continue
    }
    path += `${run === 0 ? 'M' : 'L'}${pixel(point[0])},${pixel(point[1])}`
    run += 1
  }
  if (run === 1) path += 'l0,0'
  return path
}

/** The index of the sample closest to `value` in ascending `times`; -1 without samples. */
export function nearestIndex(times: readonly number[], value: number): number {
  if (times.length === 0) return -1
  let low = 0
  let high = times.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (times[middle] < value) low = middle + 1
    else high = middle
  }
  if (low > 0 && Math.abs(times[low - 1] - value) <= Math.abs(times[low] - value)) return low - 1
  return low
}
