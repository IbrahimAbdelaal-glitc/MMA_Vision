import type { CandidateEvent, CandidateEvents, DirectionData, DirectionRow } from '../types/api'
import type { DetectionClass } from '../types/dashboard'
import { parseCsv, type CsvTable } from '../utils/csv'
import { toCount, toNumber } from '../utils/numbers'
import { pointsFor } from '../utils/scoring'
import { ApiError } from './http'

/*
 * The strike-like movement candidates of a completed job, read from the
 * classification stage's CSV, and the direction stage's measurements of the
 * same events. Values are converted, never filled in: a cell that is empty or
 * "nan" is null, and a row whose fighter or class is not recognised is
 * counted and left out.
 */

const DETECTION_CLASSES: readonly DetectionClass[] = ['Very Strong', 'Strong', 'Review', 'Low']

/** The columns the dashboard shows, as classified_strike_candidates.csv names them. */
const EVENT_COLUMNS = [
  'fighter',
  'limb',
  'event_type',
  'start_time',
  'peak_time',
  'end_time',
  'peak_speed_px_s',
  'keypoint_confidence',
  'kinematic_score',
  'detection_class',
] as const

const DIRECTION_COLUMNS = [
  ...EVENT_COLUMNS,
  'approach_change_px',
  'direction_alignment',
  'valid_samples',
] as const

/**
 * Two files describe the same event when its peak times agree to within a
 * microsecond. Comparing the text would not do: pandas may rewrite a float's
 * last digit when a later stage saves the rows again.
 */
const SAME_MOMENT_SECONDS = 1e-6

/** Less than one frame at 60 fps: "the event that starts here" is not "the next one". */
const STEP_TOLERANCE_SECONDS = 0.01

function requireColumns(table: CsvTable, columns: readonly string[], fileName: string): void {
  const missing = columns.filter((column) => !table.columns.includes(column))
  if (missing.length > 0) {
    throw new ApiError(
      'invalid-response',
      `${fileName} has no ${missing.map((column) => `"${column}"`).join(' or ')} column.`,
    )
  }
}

function readEventRow(row: Record<string, string>): Omit<CandidateEvent, 'id'> | null {
  const corner = row.fighter.trim().toLowerCase()
  const detectionClass = DETECTION_CLASSES.find((name) => name === row.detection_class.trim())
  if ((corner !== 'blue' && corner !== 'red') || !detectionClass) return null

  return {
    corner,
    detectionClass,
    eventType: row.event_type.trim(),
    side: row.limb.trim(),
    startTime: toNumber(row.start_time),
    peakTime: toNumber(row.peak_time),
    endTime: toNumber(row.end_time),
    peakSpeed: toNumber(row.peak_speed_px_s),
    keypointConfidence: toNumber(row.keypoint_confidence),
    kinematicScore: toNumber(row.kinematic_score),
  }
}

/** classified_strike_candidates.csv: every candidate, with its class. */
export function readCandidateEvents(csvText: string): CandidateEvents {
  const table = parseCsv(csvText)
  requireColumns(table, EVENT_COLUMNS, 'classified_strike_candidates.csv')

  const events: CandidateEvent[] = []
  let unrecognisedRows = 0
  table.rows.forEach((row, index) => {
    const event = readEventRow(row)
    if (event) {
      // The row number identifies the event, so it stays the same on every load.
      events.push({ id: `event-${index + 1}`, ...event })
    } else {
      unrecognisedRows += 1
    }
  })
  return { events, unrecognisedRows }
}

/** opponent_direction_analysis.csv: the same events, with how each one moved relative to the opponent. */
export function readDirection(csvText: string): DirectionData {
  const table = parseCsv(csvText)
  requireColumns(table, DIRECTION_COLUMNS, 'opponent_direction_analysis.csv')

  const rows: DirectionRow[] = []
  let unrecognisedRows = 0
  for (const row of table.rows) {
    const event = readEventRow(row)
    if (!event) {
      unrecognisedRows += 1
      continue
    }
    rows.push({
      ...event,
      approachChange: toNumber(row.approach_change_px),
      alignment: toNumber(row.direction_alignment),
      validSamples: toCount(row.valid_samples),
    })
  }
  return { rows, unrecognisedRows }
}

export type LinkedDirectionRow = DirectionRow & {
  /** The matching event of the classification file, or null when none matches exactly one. */
  eventId: string | null
}

/**
 * Pairs each direction row with its event in the classification file: same
 * fighter, side, movement type and class, and the same peak time.
 */
export function linkDirection(
  events: readonly CandidateEvent[],
  rows: readonly DirectionRow[],
): LinkedDirectionRow[] {
  return rows.map((row) => {
    const matches = events.filter(
      (event) =>
        event.corner === row.corner &&
        event.side === row.side &&
        event.eventType === row.eventType &&
        event.detectionClass === row.detectionClass &&
        event.peakTime !== null &&
        row.peakTime !== null &&
        Math.abs(event.peakTime - row.peakTime) <= SAME_MOMENT_SECONDS,
    )
    return { ...row, eventId: matches.length === 1 ? matches[0].id : null }
  })
}

export interface ClassDirection {
  detectionClass: DetectionClass
  events: number
  /** Events with a direction alignment. The others had too few usable frames. */
  measured: number
  /** Mean alignment of the measured events, as the backend's report computes it. */
  alignment: number | null
  /** Mean approach change, in pixels, over the events that have one. */
  approachChange: number | null
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * The averages of opponent_direction_report.txt, one per class. Like pandas'
 * mean(), each average skips the events that have no value.
 */
export function directionByClass(rows: readonly DirectionRow[]): ClassDirection[] {
  return DETECTION_CLASSES.map((detectionClass) => {
    const group = rows.filter((row) => row.detectionClass === detectionClass)
    const alignments = group.flatMap((row) => (row.alignment === null ? [] : [row.alignment]))
    const approaches = group.flatMap((row) =>
      row.approachChange === null ? [] : [row.approachChange],
    )
    return {
      detectionClass,
      events: group.length,
      measured: alignments.length,
      alignment: mean(alignments),
      approachChange: mean(approaches),
    }
  })
}

/** The events that score points under the scoring rules: Strong and Very Strong. */
export function scoredEvents<T extends { detectionClass: DetectionClass }>(events: readonly T[]): T[] {
  return events.filter((event) => pointsFor(event.detectionClass) > 0)
}

/** Events in the order they peak. The sort is stable, so events at the same moment keep file order. */
export function sortByPeak<T extends { peakTime: number | null }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    if (a.peakTime === null || b.peakTime === null) {
      return a.peakTime === b.peakTime ? 0 : a.peakTime === null ? 1 : -1
    }
    return a.peakTime - b.peakTime
  })
}

/**
 * The event after (step 1) or before (step -1) the selected one, in the given
 * order. Without a selection it goes by start time from the replay position,
 * and without either, to the first or last event.
 */
export function adjacentEvent(
  ordered: readonly CandidateEvent[],
  selectedId: string | null,
  from: number | null,
  step: 1 | -1,
): CandidateEvent | null {
  const index = selectedId === null ? -1 : ordered.findIndex((event) => event.id === selectedId)
  if (index !== -1) return ordered[index + step] ?? null

  if (from === null) return (step === 1 ? ordered[0] : ordered.at(-1)) ?? null

  let best: CandidateEvent | null = null
  for (const event of ordered) {
    const start = event.startTime
    if (start === null) continue
    const later = start > from + STEP_TOLERANCE_SECONDS
    const earlier = start < from - STEP_TOLERANCE_SECONDS
    if (step === 1 && later && (best === null || start < best.startTime!)) best = event
    if (step === -1 && earlier && (best === null || start > best.startTime!)) best = event
  }
  return best
}
