import type {
  Artifact,
  ArtifactKind,
  ClassCounts,
  Classification,
  JobResults,
  JobStatus,
  JobStatusValue,
  Scorecard,
  ScorecardRow,
} from '../types/api'
import type { Corner, DetectionClass } from '../types/dashboard'
import { parseCsv } from '../utils/csv'
import { toCount, toNumber } from '../utils/numbers'
import { pointsFor } from '../utils/scoring'
import { API_PREFIX, ApiError, isRecord } from './http'

/*
 * Checks each API answer against the contract in api/main.py and converts it
 * for the dashboard. Text numbers become numbers. A value that cannot be read
 * becomes null and, where it matters, an issue in plain words. Nothing is
 * filled in or estimated.
 */

const JOB_STATUSES: readonly string[] = ['queued', 'processing', 'completed', 'failed']
const DETECTION_CLASSES: readonly DetectionClass[] = ['Very Strong', 'Strong', 'Review', 'Low']
const CORNER_NAMES: Record<Corner, string> = { blue: 'Blue', red: 'Red' }

/** The backend's job IDs are UUIDs. This pattern also keeps them safe inside a URL path. */
const JOB_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value)
}

function isJobStatusValue(value: unknown): value is JobStatusValue {
  return typeof value === 'string' && JOB_STATUSES.includes(value)
}

function unexpected(what: string): ApiError {
  return new ApiError('invalid-response', `The backend sent an unexpected ${what}.`)
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** POST /jobs */
export function normalizeUpload(raw: unknown): { jobId: string } {
  if (!isRecord(raw) || !isJobId(raw.job_id)) throw unexpected('upload answer')
  return { jobId: raw.job_id }
}

/** GET /jobs/{job_id} */
export function normalizeJobStatus(raw: unknown): JobStatus {
  if (!isRecord(raw) || !isJobId(raw.job_id) || !isJobStatusValue(raw.status)) {
    throw unexpected('job status')
  }
  const progress = toNumber(raw.progress)

  return {
    jobId: raw.job_id,
    status: raw.status,
    originalFilename: textOrNull(raw.original_filename),
    fileSizeBytes: toCount(raw.file_size_bytes),
    progress: progress !== null && progress >= 0 && progress <= 100 ? progress : null,
    stagesCompleted: toCount(raw.stages_completed),
    totalStages: toCount(raw.total_stages),
    currentStage: textOrNull(raw.current_stage),
    error: textOrNull(raw.error),
    createdAt: textOrNull(raw.created_at),
    updatedAt: textOrNull(raw.updated_at),
  }
}

/** GET /jobs/{job_id}/results */
export function normalizeResults(raw: unknown): JobResults {
  if (!isRecord(raw) || !Array.isArray(raw.scorecard)) throw unexpected('results answer')
  return { scorecard: normalizeScorecard(raw.scorecard), report: textOrNull(raw.report) }
}

/** The experimental_scorecard.csv column behind each field. */
const SCORECARD_COLUMNS: ReadonlyArray<[keyof ScorecardRow, string]> = [
  ['totalEvents', 'total_events'],
  ['punchLike', 'punch_like'],
  ['kickLike', 'kick_like'],
  ['strong', 'strong_events'],
  ['veryStrong', 'very_strong_events'],
  ['activityScore', 'activity_score'],
]

/**
 * The scorecard rows from /results, with every value converted. The backend's
 * own score is kept as it is; it is only checked against the scoring rules
 * the dashboard displays, so a disagreement is reported instead of hidden.
 */
export function normalizeScorecard(rows: readonly unknown[]): Scorecard {
  const issues: string[] = []

  const readFighter = (corner: Corner): ScorecardRow | null => {
    const name = CORNER_NAMES[corner]
    const row = rows.find(
      (candidate) =>
        isRecord(candidate) &&
        typeof candidate.fighter === 'string' &&
        candidate.fighter.trim().toLowerCase() === corner,
    )
    if (!isRecord(row)) {
      issues.push(`The scorecard has no row for the ${name} fighter.`)
      return null
    }

    const values: ScorecardRow = {
      totalEvents: null,
      punchLike: null,
      kickLike: null,
      strong: null,
      veryStrong: null,
      activityScore: null,
    }
    for (const [field, column] of SCORECARD_COLUMNS) {
      values[field] = toCount(row[column])
      if (values[field] === null) {
        issues.push(`${name} ${column} is not a whole number (${JSON.stringify(row[column] ?? null)}).`)
      }
    }

    const { strong, veryStrong, activityScore } = values
    if (strong !== null && veryStrong !== null && activityScore !== null) {
      const veryStrongPoints = pointsFor('Very Strong')
      const strongPoints = pointsFor('Strong')
      const expected = veryStrong * veryStrongPoints + strong * strongPoints
      if (expected !== activityScore) {
        issues.push(
          `${name}'s score of ${activityScore} does not match the scoring rules ` +
            `(${veryStrong} × ${veryStrongPoints} + ${strong} × ${strongPoints} = ${expected}).`,
        )
      }
    }
    return values
  }

  const blue = readFighter('blue')
  const red = readFighter('red')
  return { blue, red, issues }
}

const KIND_BY_EXTENSION: Record<string, ArtifactKind> = {
  txt: 'report',
  csv: 'table',
  png: 'chart',
  jpg: 'chart',
  jpeg: 'chart',
  mp4: 'video',
}
const KIND_ORDER: readonly ArtifactKind[] = ['report', 'table', 'chart', 'video', 'other']

function kindOf(name: string): ArtifactKind {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return KIND_BY_EXTENSION[extension] ?? 'other'
}

/** GET /jobs/{job_id}/artifacts, grouped by kind and sorted by path within each group. */
export function normalizeArtifacts(raw: unknown): Artifact[] {
  if (!isRecord(raw) || !Array.isArray(raw.artifacts)) throw unexpected('artifact list')

  return raw.artifacts
    .flatMap((item): Artifact[] => {
      // Only links back into the backend's own job files are kept.
      if (
        !isRecord(item) ||
        typeof item.filename !== 'string' ||
        typeof item.download_url !== 'string' ||
        !item.download_url.startsWith('/jobs/')
      ) {
        return []
      }
      const name = item.filename.split('/').pop() || item.filename
      return [
        {
          path: item.filename,
          name,
          sizeBytes: toCount(item.size_bytes),
          href: `${API_PREFIX}${item.download_url}`,
          kind: kindOf(name),
        },
      ]
    })
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.path.localeCompare(b.path),
    )
}

function emptyCounts(): ClassCounts {
  return { 'Very Strong': 0, Strong: 0, Review: 0, Low: 0 }
}

/**
 * Per-fighter class counts from classified_strike_candidates.csv. It is the
 * only output with the Review and Low candidates, which the scorecard leaves
 * out because they score no points.
 */
export function countClassifications(csvText: string): Classification {
  const { columns, rows } = parseCsv(csvText)
  const missing = ['fighter', 'detection_class'].filter((column) => !columns.includes(column))
  if (missing.length > 0) {
    throw new ApiError(
      'invalid-response',
      `classified_strike_candidates.csv has no ${missing.map((column) => `"${column}"`).join(' or ')} column.`,
    )
  }

  const counts: Record<Corner, ClassCounts> = { blue: emptyCounts(), red: emptyCounts() }
  let unrecognisedRows = 0
  for (const row of rows) {
    const corner = row.fighter.trim().toLowerCase()
    const detectionClass = DETECTION_CLASSES.find((name) => name === row.detection_class.trim())
    if ((corner === 'blue' || corner === 'red') && detectionClass) {
      counts[corner][detectionClass] += 1
    } else {
      unrecognisedRows += 1
    }
  }
  return { blue: counts.blue, red: counts.red, unrecognisedRows }
}

/**
 * True when the classification file disagrees with the scorecard on the
 * scored classes (Strong, Very Strong). Then the two files do not describe the
 * same run, and the Review and Low counts cannot be trusted next to it.
 */
export function classificationContradictsScorecard(
  classification: Classification,
  scorecard: Scorecard,
): boolean {
  return (['blue', 'red'] as const).some((corner) => {
    const row = scorecard[corner]
    if (!row) return false
    const counts = classification[corner]
    return (
      (row.strong !== null && row.strong !== counts.Strong) ||
      (row.veryStrong !== null && row.veryStrong !== counts['Very Strong'])
    )
  })
}
