import type { JobState } from '../../hooks/useAnalysisJob'
import { ARTIFACT_PATHS, findArtifact } from '../../services/artifactPaths'
import { classificationContradictsScorecard } from '../../services/normalize'
import type { AnalysisData, Artifact, ClassCounts, Scorecard } from '../../types/api'
import type { Corner } from '../../types/dashboard'
import { formatDuration, formatFileSize } from '../../utils/format'
import { secondsBetween } from '../../utils/time'
import { shortJobId } from './dashboardStatus'

/*
 * What the Match Ended state says about the job, in one place. Each function
 * reads the job as the backend reported it and returns the words or values a
 * panel shows. Nothing here estimates or fills in a missing value.
 */

const NAMES: Record<Corner, string> = { blue: 'Blue', red: 'Red' }

/** How far the job shown in Match Ended has got. */
export type MatchPhase =
  | { kind: 'no-job' }
  | { kind: 'unavailable'; message: string }
  /** A job is named, but the backend has not reported its status yet. */
  | { kind: 'checking' }
  | { kind: 'running' }
  | { kind: 'failed'; message: string }
  | { kind: 'loading' }
  | { kind: 'loaded'; data: AnalysisData }

export function matchPhase(job: JobState): MatchPhase {
  if (job.trackingError) return { kind: 'unavailable', message: job.trackingError }
  const status = job.status
  if (status?.status === 'failed') {
    return {
      kind: 'failed',
      message: status.error ?? 'The backend reported a failure without a reason.',
    }
  }
  if (status?.status === 'completed') {
    return job.analysis.state === 'loaded'
      ? { kind: 'loaded', data: job.analysis.data }
      : { kind: 'loading' }
  }
  if (!job.jobId) return job.upload ? { kind: 'running' } : { kind: 'no-job' }
  return status ? { kind: 'running' } : { kind: 'checking' }
}

export type NoticeTone = 'warn' | 'error' | 'info'

export interface MatchNotice {
  tone: NoticeTone
  label: string
  message: string
  /** Offer to load the results again: some part failed to load. */
  retry: boolean
}

export function matchNotice(phase: MatchPhase): MatchNotice {
  switch (phase.kind) {
    case 'no-job':
      return {
        tone: 'warn',
        label: 'Results unavailable',
        message:
          'Analyse a video, or open a completed job, to see its results here. Live estimates are never used to calculate final results.',
        retry: false,
      }
    case 'unavailable':
      return { tone: 'error', label: 'Job unavailable', message: phase.message, retry: false }
    case 'checking':
      return {
        tone: 'warn',
        label: 'Checking job',
        message: 'Asking the backend for the status of this job.',
        retry: false,
      }
    case 'running':
      return {
        tone: 'warn',
        label: 'Analysis running',
        message: 'Results appear here when the backend finishes the nine-stage analysis.',
        retry: false,
      }
    case 'failed':
      return { tone: 'error', label: 'Analysis failed', message: phase.message, retry: false }
    case 'loading':
      return {
        tone: 'info',
        label: 'Loading results',
        message: 'Reading the scorecard and the list of job files from the backend.',
        retry: false,
      }
    case 'loaded': {
      const { results, artifacts, classification, events, direction, movement, movementReport } =
        phase.data
      const parts = [results, artifacts, classification, events, direction, movement, movementReport]
      // A file the run did not write is "missing", not an error: retrying cannot produce it.
      if (parts.some((part) => part.state === 'error')) {
        return {
          tone: 'warn',
          label: 'Some results could not be loaded',
          message: 'The panels below say which part is missing and why.',
          retry: true,
        }
      }
      return {
        tone: 'info',
        label: 'Experimental results',
        message:
          'Computed by the MMA Vision backend from pose estimation and movement heuristics. Landed strikes and damage are not measured, and this is not official MMA judging.',
        retry: false,
      }
    }
  }
}

export interface MatchHeading {
  title: string
  subtitle: string
  statusText: string
}

export function matchHeading(phase: MatchPhase, job: JobState): MatchHeading {
  const status = job.status
  const statusText = job.trackingError
    ? 'unavailable'
    : (status?.status ?? (job.jobId ? 'checking' : job.upload ? 'uploading' : 'unavailable'))

  if (phase.kind === 'no-job' || phase.kind === 'unavailable') {
    return {
      title: 'No completed analysis loaded',
      subtitle:
        'The post-fight scorecard, movement insights and event history appear here once a job finishes.',
      statusText,
    }
  }

  const titles: Record<Exclude<MatchPhase['kind'], 'no-job' | 'unavailable'>, string> = {
    checking: 'Waiting for the job status',
    running: 'Analysis in progress',
    failed: 'No results for this job',
    loading: 'Final fight analysis',
    loaded: 'Final fight analysis',
  }
  const title = titles[phase.kind]

  // A job opened from the address has no local file, so its name comes from the backend.
  const fileName = status?.originalFilename ?? job.file?.name ?? null
  const sizeBytes = status?.fileSizeBytes ?? job.file?.size ?? null
  const took =
    status?.status === 'completed' ? secondsBetween(status.createdAt, status.updatedAt) : null
  const parts = [
    fileName ?? (job.jobId ? `Job ${shortJobId(job.jobId)}` : 'Uploading video'),
    sizeBytes === null ? null : formatFileSize(sizeBytes),
    took === null ? null : `analysis took ${formatDuration(took)}`,
  ]
  return { title, subtitle: parts.filter(Boolean).join(' · '), statusText }
}

/** The scorecard, once it has loaded. */
export function scorecardOf(phase: MatchPhase): Scorecard | null {
  return phase.kind === 'loaded' && phase.data.results.state === 'ready'
    ? phase.data.results.data.scorecard
    : null
}

export function activityScore(phase: MatchPhase, corner: Corner): number | null {
  return scorecardOf(phase)?.[corner]?.activityScore ?? null
}

/** The line under a fighter's score: where it came from, or why there is none. */
export function scoreCaption(phase: MatchPhase, corner: Corner): string {
  switch (phase.kind) {
    case 'no-job':
      return 'Unavailable · awaiting completed-job results'
    case 'unavailable':
      return 'Unavailable · the job cannot be loaded'
    case 'checking':
      return 'Waiting for the job status'
    case 'running':
      return 'Waiting for the analysis to finish'
    case 'failed':
      return 'Unavailable · the analysis failed'
    case 'loading':
      return 'Loading results from the backend'
    case 'loaded': {
      const { results } = phase.data
      if (results.state === 'missing') return 'Unavailable · this job has no scorecard'
      if (results.state === 'error') return 'Unavailable · results could not be loaded'
      const row = results.data.scorecard[corner]
      if (!row) return `Unavailable · no ${NAMES[corner]} row in the scorecard`
      if (row.activityScore === null) return 'Unavailable · unreadable value in the scorecard'
      return 'From the backend’s experimental scorecard'
    }
  }
}

/** What the result panel says while no fighter can be ranked. Names nobody. */
export function pendingResultLabel(phase: MatchPhase): string {
  switch (phase.kind) {
    case 'no-job':
      return 'Awaiting backend data'
    case 'unavailable':
      return 'Job unavailable'
    case 'checking':
      return 'Checking job'
    case 'running':
      return 'Analysis in progress'
    case 'failed':
      return 'No result: the analysis failed'
    case 'loading':
      return 'Loading results'
    case 'loaded':
      return 'Scores unavailable'
  }
}

export interface UnscoredCounts {
  /** Review and Low counts per fighter, or null when they cannot be shown. */
  counts: Record<Corner, ClassCounts> | null
  /** Why they are not shown, or a caveat about them. */
  note: string | null
}

/**
 * The Review and Low counts, which only classified_strike_candidates.csv has.
 * They are left out when that file disagrees with the scorecard, because then
 * the two files do not describe the same run.
 */
export function unscoredCounts(phase: MatchPhase): UnscoredCounts {
  if (phase.kind !== 'loaded') return { counts: null, note: null }

  const { classification } = phase.data
  if (classification.state !== 'ready') return { counts: null, note: classification.message }

  const scorecard = scorecardOf(phase)
  if (scorecard && classificationContradictsScorecard(classification.data, scorecard)) {
    return {
      counts: null,
      note: 'classified_strike_candidates.csv disagrees with the scorecard on Strong and Very Strong events, so its Review and Low counts are not shown.',
    }
  }

  const { blue, red, unrecognisedRows } = classification.data
  const rows = unrecognisedRows === 1 ? '1 row' : `${unrecognisedRows} rows`
  return {
    counts: { blue, red },
    note:
      unrecognisedRows > 0
        ? `${rows} of classified_strike_candidates.csv had an unrecognised fighter or class and ${unrecognisedRows === 1 ? 'is' : 'are'} not counted.`
        : null,
  }
}

/** One of the job's files, as far as the dashboard knows it. */
export type FileLookup =
  | { state: 'found'; file: Artifact }
  /** The run did not write this file. */
  | { state: 'absent' }
  /** Not known (yet): a short word for why. */
  | { state: 'unknown'; label: string }

export function lookupFile(phase: MatchPhase, path: string): FileLookup {
  if (phase.kind === 'running' || phase.kind === 'checking') {
    return { state: 'unknown', label: 'Pending' }
  }
  if (phase.kind === 'loading') return { state: 'unknown', label: 'Loading' }
  if (phase.kind !== 'loaded' || phase.data.artifacts.state !== 'ready') {
    return { state: 'unknown', label: 'Unavailable' }
  }
  const file = findArtifact(phase.data.artifacts.data, path)
  return file ? { state: 'found', file } : { state: 'absent' }
}

/** Why the list of job files is not available, once the results have loaded. */
export function fileListProblem(phase: MatchPhase): string | null {
  return phase.kind === 'loaded' && phase.data.artifacts.state !== 'ready'
    ? phase.data.artifacts.message
    : null
}

export function fileCount(phase: MatchPhase): number | null {
  return phase.kind === 'loaded' && phase.data.artifacts.state === 'ready'
    ? phase.data.artifacts.data.length
    : null
}

/** The job's progress in a few words, for the artifacts panel. */
export function progressSummary(job: JobState): string {
  if (job.trackingError) return 'Unavailable'
  if (!job.jobId) return job.upload ? 'Uploading' : 'No job loaded'
  const status = job.status
  if (!status) return 'Checking'
  const stages =
    status.stagesCompleted !== null && status.totalStages !== null
      ? `${status.stagesCompleted} of ${status.totalStages} stages`
      : null
  switch (status.status) {
    case 'queued':
      return 'Queued'
    case 'processing':
      return stages ? `Processing · ${stages}` : 'Processing'
    case 'completed':
      return stages ? `${stages} complete` : 'Complete'
    case 'failed':
      return stages ? `Failed after ${stages}` : 'Failed'
  }
}

/** What the event timeline says in place of rows, or null when it has rows to show. */
export function timelineMessage(phase: MatchPhase): string | null {
  if (phase.kind !== 'loaded') {
    return 'No strike-event data retrieved. Timestamps, classifications and event details will come from the completed job’s CSV.'
  }
  const { events } = phase.data
  if (events.state === 'ready') return null
  const finalEvents = lookupFile(phase, ARTIFACT_PATHS.finalEvents)
  const fallback =
    finalEvents.state === 'found' ? ` The scored events are still in ${finalEvents.file.name}, under Job files below.` : ''
  return `Event rows unavailable: ${events.message}${fallback}`
}

/**
 * Where the time axis of the event strip ends: the last analysed frame,
 * from the movement data or its report, and never before the last event.
 */
export function timelineEnd(data: AnalysisData): number | null {
  const lastFrame =
    data.movement.state === 'ready'
      ? (data.movement.data.time.at(-1) ?? null)
      : data.movementReport.state === 'ready'
        ? data.movementReport.data.durationSeconds
        : null
  const lastEvent =
    data.events.state === 'ready'
      ? data.events.data.events.reduce<number | null>((latest, event) => {
          const end = event.endTime ?? event.peakTime
          return end !== null && (latest === null || end > latest) ? end : latest
        }, null)
      : null
  const end = Math.max(lastFrame ?? 0, lastEvent ?? 0)
  return end > 0 ? end : null
}
