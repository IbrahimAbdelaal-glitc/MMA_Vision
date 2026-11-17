import type { Corner, DetectionClass } from './dashboard'

/*
 * What the MMA Vision API (api/main.py) sends, after the dashboard has checked
 * it and turned text numbers into numbers. Anything the backend did not send,
 * or sent in a form that could not be read, is null, never a guess.
 */

/** The four values api/main.py writes into a job's status.json. */
export type JobStatusValue = 'queued' | 'processing' | 'completed' | 'failed'

/** GET /jobs/{job_id} */
export interface JobStatus {
  jobId: string
  status: JobStatusValue
  originalFilename: string | null
  fileSizeBytes: number | null
  /** 0 to 100, exactly as the backend reports it. */
  progress: number | null
  stagesCompleted: number | null
  totalStages: number | null
  /** "Queued", "Starting pipeline", a stage name, "Completed" or "Failed". */
  currentStage: string | null
  error: string | null
  /** ISO 8601 timestamps written by the backend, in UTC. */
  createdAt: string | null
  updatedAt: string | null
}

/** One fighter's row of experimental_scorecard.csv. */
export interface ScorecardRow {
  totalEvents: number | null
  punchLike: number | null
  kickLike: number | null
  strong: number | null
  veryStrong: number | null
  activityScore: number | null
}

export interface Scorecard {
  blue: ScorecardRow | null
  red: ScorecardRow | null
  /** Problems found while reading it, in plain words. Empty when it read cleanly. */
  issues: string[]
}

/** GET /jobs/{job_id}/results */
export interface JobResults {
  scorecard: Scorecard
  /** experimental_scorecard_report.txt, or null when the backend has none. */
  report: string | null
}

export type ArtifactKind = 'report' | 'table' | 'chart' | 'video' | 'other'

/** One file from GET /jobs/{job_id}/artifacts. */
export interface Artifact {
  /** Relative to the job folder, such as "results/movement_report.txt". */
  path: string
  name: string
  sizeBytes: number | null
  /** The API's own download_url, reached through the dev-server proxy. */
  href: string
  kind: ArtifactKind
}

export type ClassCounts = Record<DetectionClass, number>

/** Per-fighter class counts from classified_strike_candidates.csv. */
export interface Classification {
  blue: ClassCounts
  red: ClassCounts
  /** Rows whose fighter or class was not recognised. They are not counted anywhere. */
  unrecognisedRows: number
}

/**
 * One strike-like movement candidate, as the classification stage wrote it to
 * classified_strike_candidates.csv. It is an estimated movement, not a
 * confirmed landed strike.
 */
export interface CandidateEvent {
  /** "event-<row>", the event's data row in the file: unique within the job. */
  id: string
  corner: Corner
  detectionClass: DetectionClass
  /** "punch-like" or "kick-like", as written by the pipeline. */
  eventType: string
  /** "left" or "right": the side of the wrist (punch-like) or ankle (kick-like) that moved. */
  side: string
  /** Seconds from the start of the video: frame number divided by the video's frame rate. */
  startTime: number | null
  peakTime: number | null
  endTime: number | null
  /** Speed of the wrist or ankle at the peak, in pixels per second. */
  peakSpeed: number | null
  /** Mean pose keypoint confidence for the limb, from 0 to 1. */
  keypointConfidence: number | null
  /** Heuristic ranking from 0 to 100. It is not a probability. */
  kinematicScore: number | null
}

export interface CandidateEvents {
  /** In file order. */
  events: CandidateEvent[]
  /** Rows left out because their fighter or class was not recognised. */
  unrecognisedRows: number
}

/** One row of opponent_direction_analysis.csv: an event and how it moved relative to the opponent. */
export interface DirectionRow extends Omit<CandidateEvent, 'id'> {
  /**
   * How much closer the wrist or ankle came to the opponent's torso centre,
   * in pixels, from 8–3 frames before the peak to the peak. Negative: farther away.
   */
  approachChange: number | null
  /** Cosine of the angle between the limb's movement and the direction to the opponent: +1 toward, 0 sideways, −1 away. */
  alignment: number | null
  /** Frames, of the 12 examined, in which both the limb and the opponent's torso were visible. */
  validSamples: number | null
}

export interface DirectionData {
  rows: DirectionRow[]
  unrecognisedRows: number
}

/**
 * The per-frame series the backend's four movement charts plot, from
 * movement_metrics_cleaned.csv. null is a frame without a value.
 */
export interface MovementSeries {
  /** Seconds from the start of the video, one per frame. */
  time: number[]
  /** Speed of each fighter's bounding-box centre, smoothed by the backend (px/s). */
  blueSpeed: Array<number | null>
  redSpeed: Array<number | null>
  /** Wrist speed, smoothed by the backend (px/s). */
  blueWrist: Array<number | null>
  redWrist: Array<number | null>
  /** Distance between the two bounding-box centres, smoothed by the backend (px). */
  distance: Array<number | null>
  /** Distance each bounding-box centre has travelled since the first frame (px). */
  blueTotal: Array<number | null>
  redTotal: Array<number | null>
  /** Rows left out because their time could not be read. */
  skippedRows: number
}

export interface SpeedFigures {
  median: number | null
  /** 95th percentile. */
  p95: number | null
}

export interface FighterMovement {
  movementSpeed: SpeedFigures
  wristSpeed: SpeedFigures
  ankleSpeed: SpeedFigures
  totalMovementPx: number | null
}

/** The figures of movement_report.txt, exactly as the backend computed them. */
export interface MovementReport {
  frames: number | null
  /** The time of the last analysed frame, as the report gives it. */
  durationSeconds: number | null
  blue: FighterMovement
  red: FighterMovement
  distance: { averagePx: number | null; minimumPx: number | null; maximumPx: number | null }
}

/** One part of a completed job's analysis. Each part loads, or fails, on its own. */
export type Part<T> =
  | { state: 'ready'; data: T }
  | { state: 'missing'; message: string }
  | { state: 'error'; message: string }

export interface AnalysisData {
  results: Part<JobResults>
  artifacts: Part<Artifact[]>
  classification: Part<Classification>
  /** The same file as the class counts, read as a list of events. */
  events: Part<CandidateEvents>
  direction: Part<DirectionData>
  movement: Part<MovementSeries>
  movementReport: Part<MovementReport>
}
