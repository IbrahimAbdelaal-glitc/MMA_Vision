import { isJobActive, uploadPercent, type JobState } from '../../hooks/useAnalysisJob'
import type { BackendHealth } from '../../hooks/useBackendHealth'
import type { LivePhase } from '../../hooks/useLiveSession'
import type { DashboardView, LocalVideoSource } from '../../types/dashboard'
import type { BackendTone } from '../common/backendTone'
import type { StatusTone } from '../common/StatusChip'

/*
 * The words the top bar, notice area and status bar use for the current job.
 * Kept apart from the components so every state is worded in one place.
 */

export interface Chip {
  tone: StatusTone
  label: string
}

export const PREVIEW_CHIP: Chip = { tone: 'ready', label: 'Source preview' }
export const NO_SOURCE_CHIP: Chip = { tone: 'neutral', label: 'No source' }
export const NO_RESULTS_CHIP: Chip = { tone: 'neutral', label: 'No results' }

/** The first block of a job ID, enough to tell jobs apart on screen. */
export function shortJobId(jobId: string): string {
  return jobId.slice(0, 8)
}

/** What the Live Monitoring notice area shows: the job, or a preview not yet analysed. */
export type StageFocus = 'job' | 'preview' | 'none'

export function stageFocus(job: JobState, source: LocalVideoSource | null): StageFocus {
  if (isJobActive(job)) return 'job'
  // A newly chosen video takes over from a finished job.
  if (source && source.file !== job.file) return 'preview'
  if (job.jobId || job.trackingError) return 'job'
  return source ? 'preview' : 'none'
}

/** The top-bar chip for the job, or null when there is no job to report. */
export function jobChip(job: JobState): Chip | null {
  if (job.upload) return { tone: 'busy', label: `Uploading ${uploadPercent(job.upload)}%` }
  if (job.trackingError) return { tone: 'error', label: 'Job unavailable' }
  if (!job.jobId) return null

  const status = job.status
  if (!status) return { tone: 'busy', label: 'Checking job' }
  if (status.status === 'queued') return { tone: 'busy', label: 'Queued' }
  if (status.status === 'processing') {
    return {
      tone: 'busy',
      label: status.progress === null ? 'Processing' : `Processing ${Math.round(status.progress)}%`,
    }
  }
  if (status.status === 'completed') return { tone: 'done', label: 'Analysis complete' }
  return { tone: 'error', label: 'Analysis failed' }
}

export function backendIndicator(
  health: BackendHealth,
  job: JobState,
): { tone: BackendTone; label: string } {
  // A failing status check is fresher evidence than the last health check.
  if (job.connectionError?.unreachable) return { tone: 'warn', label: 'Backend unreachable' }
  if (health.state === 'online') return { tone: 'ok', label: 'Backend connected' }
  if (health.state === 'offline') return { tone: 'warn', label: 'Backend unreachable' }
  return { tone: 'muted', label: 'Checking backend' }
}

/** The line under the backend indicator: which job is loaded. */
export function jobSummary(job: JobState): string {
  if (job.upload) return `Uploading ${job.upload.file.name}`
  if (!job.jobId) return job.trackingError ? 'Job unavailable' : 'No job loaded'
  const state = job.trackingError ? 'unavailable' : (job.status?.status ?? 'checking')
  return `Job ${shortJobId(job.jobId)} · ${state}`
}

const LIVE_TEXT: Record<Exclude<LivePhase, 'idle'>, { label: string; message: string }> = {
  uploading: {
    label: 'Live: uploading',
    message: 'Uploading the video and checking its frame timing for live analysis.',
  },
  starting: { label: 'Live: starting', message: 'Loading the pose model for live analysis.' },
  live: {
    label: 'Live analysis',
    message: 'Provisional live analysis of this video. The final scorecard comes from Analyse offline.',
  },
  ended: {
    label: 'Live ended',
    message: 'Live values are provisional. Analyse offline for the final scorecard, or Discard.',
  },
  'handing-off': { label: 'Live ended', message: 'Handing the video over to the nine-stage offline analysis.' },
}

export function statusBarText(
  view: DashboardView,
  job: JobState,
  focus: StageFocus,
  livePhase: LivePhase = 'idle',
): { label: string; message: string } {
  // On Live Monitoring a live session is what the screen shows, whatever job came before.
  if (view === 'live' && livePhase !== 'idle') return LIVE_TEXT[livePhase]

  const status = job.status
  // Until the backend answers, nothing is known about the job: say only that.
  const checking = job.jobId !== null && status === null && !job.trackingError && !job.upload
  const checkingText = {
    label: 'Checking job',
    message: 'Waiting for the backend to report the status of this job.',
  }

  if (view === 'ended') {
    if (checking) return checkingText
    if (job.jobId && status?.status === 'completed') {
      return {
        label: 'Post-fight results',
        message: `Source of truth: MMA Vision backend · job ${shortJobId(job.jobId)}`,
      }
    }
    if (status?.status === 'failed') {
      return { label: 'Analysis failed', message: status.error ?? 'The backend reported a failure.' }
    }
    if (job.jobId && isJobActive(job)) {
      return {
        label: 'Analysis running',
        message: 'Results appear here when the backend finishes the nine-stage analysis.',
      }
    }
    return {
      label: 'Post-fight results',
      message: 'Source of truth: MMA Vision backend · no completed job retrieved',
    }
  }

  if (focus === 'job') {
    if (job.upload) {
      return {
        label: 'Uploading',
        message:
          'Sending the video to the backend for offline analysis. Live counters stay empty: this is not live monitoring.',
      }
    }
    if (checking) return checkingText
    if (isJobActive(job)) {
      return {
        label: 'Analysing',
        message:
          'Offline analysis of the uploaded video. Live counters stay empty: this is not live monitoring.',
      }
    }
    if (job.trackingError) return { label: 'Job unavailable', message: job.trackingError }
    if (status?.status === 'failed') {
      return { label: 'Analysis failed', message: status.error ?? 'The backend reported a failure.' }
    }
    return {
      label: 'Analysis complete',
      message:
        'The final results are in Match Ended. Live counters need the live engine, which is not connected.',
    }
  }
  if (focus === 'preview') {
    return {
      label: 'Source preview',
      message: 'This video is playing from your computer. It has not been uploaded or analysed.',
    }
  }
  return {
    label: 'No data yet',
    message: 'Counters, overlays and metrics stay empty until real analysis supplies them.',
  }
}
