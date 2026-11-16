import type { DetectionClass } from './dashboard'

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

/** One part of a completed job's analysis. Each part loads, or fails, on its own. */
export type Part<T> =
  | { state: 'ready'; data: T }
  | { state: 'missing'; message: string }
  | { state: 'error'; message: string }

export interface AnalysisData {
  results: Part<JobResults>
  artifacts: Part<Artifact[]>
  classification: Part<Classification>
}
