import type { FighterMovement, MovementReport, MovementSeries, SpeedFigures } from '../types/api'
import { parseCsv } from '../utils/csv'
import { toCount, toNumber } from '../utils/numbers'
import { ApiError } from './http'

/*
 * The movement output of the pipeline's second stage (src/analyze_movement.py):
 * the per-frame series its four charts plot, and the figures of its report.
 * Nothing is smoothed, filled in or recomputed here; the smoothing is the
 * backend's own (gaps up to 6 frames interpolated, then a rolling median of
 * 9 frames and a rolling mean of 5 for speeds; a rolling median of 9 frames
 * for distance).
 */

/** The column behind each series, as movement_metrics_cleaned.csv names it. */
const SERIES_COLUMNS = {
  blueSpeed: 'blue_movement_speed_px_s_smoothed',
  redSpeed: 'red_movement_speed_px_s_smoothed',
  blueWrist: 'blue_wrist_speed_px_s_smoothed',
  redWrist: 'red_wrist_speed_px_s_smoothed',
  distance: 'fighter_distance_smoothed',
  blueTotal: 'blue_total_movement_px',
  redTotal: 'red_total_movement_px',
} as const

type SeriesName = keyof typeof SERIES_COLUMNS
const SERIES_NAMES = Object.keys(SERIES_COLUMNS) as SeriesName[]
const TIME_COLUMN = 'time_seconds'

export function readMovementSeries(csvText: string): MovementSeries {
  const { columns, rows } = parseCsv(csvText)
  const required = [TIME_COLUMN, ...Object.values(SERIES_COLUMNS)]
  const missing = required.filter((column) => !columns.includes(column))
  if (missing.length > 0) {
    throw new ApiError(
      'invalid-response',
      `movement_metrics_cleaned.csv has no ${missing.map((column) => `"${column}"`).join(' or ')} column.`,
    )
  }

  const series: MovementSeries = {
    time: [],
    blueSpeed: [],
    redSpeed: [],
    blueWrist: [],
    redWrist: [],
    distance: [],
    blueTotal: [],
    redTotal: [],
    skippedRows: 0,
  }
  for (const row of rows) {
    const time = toNumber(row[TIME_COLUMN])
    // A frame that cannot be placed in time cannot be drawn.
    if (time === null) {
      series.skippedRows += 1
      continue
    }
    series.time.push(time)
    for (const name of SERIES_NAMES) series[name].push(toNumber(row[SERIES_COLUMNS[name]]))
  }
  return series
}

const REPORT_TITLE = 'MMA VISION - MOVEMENT ANALYSIS REPORT'

const SPEED_KEYS = {
  movement_speed_px_s: 'movementSpeed',
  wrist_speed_px_s: 'wristSpeed',
  ankle_speed_px_s: 'ankleSpeed',
} as const

const SPEED_LINE =
  /^(movement_speed_px_s|wrist_speed_px_s|ankle_speed_px_s): Median = (\S+) px\/s \| 95th percentile = (\S+) px\/s$/

const NO_SPEED: SpeedFigures = { median: null, p95: null }

function noFighter(): FighterMovement {
  return { movementSpeed: NO_SPEED, wristSpeed: NO_SPEED, ankleSpeed: NO_SPEED, totalMovementPx: null }
}

/** The single value a line holds, when the line has the given form. */
function valueOf(line: string, pattern: RegExp): string | null {
  return pattern.exec(line)?.[1] ?? null
}

/**
 * movement_report.txt, as analyze_movement.py writes it. A figure the report
 * does not contain, or that pandas wrote as "nan", is null.
 */
export function readMovementReport(text: string): MovementReport {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  if (lines[0] !== REPORT_TITLE) {
    throw new ApiError('invalid-response', 'movement_report.txt is not in the format the dashboard reads.')
  }

  const report: MovementReport = {
    frames: null,
    durationSeconds: null,
    blue: noFighter(),
    red: noFighter(),
    distance: { averagePx: null, minimumPx: null, maximumPx: null },
  }

  let section: 'blue' | 'red' | 'distance' | null = null
  for (const line of lines) {
    if (line === 'Blue Corner') section = 'blue'
    else if (line === 'Red Corner') section = 'red'
    else if (line === 'FIGHTER DISTANCE') section = 'distance'

    const frames = valueOf(line, /^Frames analyzed: (\S+)$/)
    if (frames !== null) report.frames = toCount(frames)
    const duration = valueOf(line, /^Video duration: (\S+) seconds$/)
    if (duration !== null) report.durationSeconds = toNumber(duration)

    if (section === 'blue' || section === 'red') {
      const fighter = report[section]
      const speed = SPEED_LINE.exec(line)
      if (speed) {
        const key = SPEED_KEYS[speed[1] as keyof typeof SPEED_KEYS]
        fighter[key] = { median: toNumber(speed[2]), p95: toNumber(speed[3]) }
      }
      const total = valueOf(line, /^Total movement: (\S+) pixels$/)
      if (total !== null) fighter.totalMovementPx = toNumber(total)
    }

    if (section === 'distance') {
      const average = valueOf(line, /^Average distance: (\S+) pixels$/)
      if (average !== null) report.distance.averagePx = toNumber(average)
      const minimum = valueOf(line, /^Minimum distance: (\S+) pixels$/)
      if (minimum !== null) report.distance.minimumPx = toNumber(minimum)
      const maximum = valueOf(line, /^Maximum distance: (\S+) pixels$/)
      if (maximum !== null) report.distance.maximumPx = toNumber(maximum)
    }
  }
  return report
}
