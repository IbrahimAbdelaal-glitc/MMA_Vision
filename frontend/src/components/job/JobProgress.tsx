import type { ReactNode } from 'react'
import { uploadPercent, type JobState } from '../../hooks/useAnalysisJob'
import { useNow } from '../../hooks/useNow'
import { POLL_INTERVAL_MS } from '../../services/pollJob'
import type { JobStatus } from '../../types/api'
import { cx } from '../../utils/cx'
import { formatDuration, formatFileSize } from '../../utils/format'
import { secondsBetween } from '../../utils/time'
import { LABEL_SURFACE } from '../video/StageLabels'

type Tone = 'busy' | 'done' | 'error'

const TONES: Record<Tone, { dot: string; text: string; bar: string }> = {
  busy: { dot: 'bg-warn motion-safe:animate-pulse', text: 'text-warn', bar: 'bg-warn' },
  done: { dot: 'bg-ended', text: 'text-ended', bar: 'bg-ended' },
  error: { dot: 'bg-corner-red', text: 'text-corner-red', bar: 'bg-corner-red' },
}

interface CardContent {
  tone: Tone
  label: string
  detail: string
  bar?: { name: string; value: number | null }
  facts?: string | null
  note?: string | null
  time?: string | null
  action?: ReactNode
}

interface JobProgressProps {
  job: JobState
  onViewResults: () => void
}

/**
 * The analysis job, in the Live Monitoring notice area: the upload, the queue,
 * the processing, and how it ended. Every value is one the backend reported.
 * The backend moves its progress when each of the nine stages starts and
 * ends, so the bar steps by about 11 % and holds still within a long stage.
 * Nothing is estimated between two reports.
 */
export function JobProgress({ job, onViewResults }: JobProgressProps) {
  const running = job.status?.status === 'queued' || job.status?.status === 'processing'
  const now = useNow(1000, running && !job.upload)
  const content = describe(job, now, onViewResults)
  const tone = TONES[content.tone]

  return (
    <section
      aria-label="Analysis job"
      className={cx(
        'area-notice overlay:w-full overlay:max-w-[560px] overlay:justify-self-center',
        LABEL_SURFACE,
      )}
    >
      <div className="flex items-start gap-x-4 gap-y-2">
        <div role="status" className="min-w-0 flex-1">
          <p className={cx('caps-heading flex items-center gap-2', tone.text)}>
            <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', tone.dot)} />
            {content.label}
          </p>
          <p className="mt-1.5 text-[13px] leading-4 font-semibold break-words text-fg">
            {content.detail}
          </p>
        </div>
        {content.time && (
          <p className="shrink-0 pt-px text-[11px] leading-[14px] text-muted tabular-nums">
            {content.time}
          </p>
        )}
        {content.action}
      </div>

      {content.bar && <ProgressBar {...content.bar} fill={tone.bar} />}

      {(content.facts || content.note) && (
        <p className="mt-2 text-[11px] leading-[14px] text-muted">
          {[content.facts, content.note].filter(Boolean).join('. ')}
        </p>
      )}

      {job.connectionError && !job.trackingError && (
        <p className="mt-2 text-[11px] leading-[14px] text-warn">
          Connection problem: {job.connectionError.message} Retrying every{' '}
          {POLL_INTERVAL_MS / 1000} s.
        </p>
      )}
    </section>
  )
}

function stagesText(status: JobStatus): string | null {
  return status.stagesCompleted !== null && status.totalStages !== null
    ? `${status.stagesCompleted} of ${status.totalStages}`
    : null
}

function describe(job: JobState, now: number, onViewResults: () => void): CardContent {
  const { upload, status, trackingError } = job

  if (upload) {
    return {
      tone: 'busy',
      label: 'Uploading',
      detail: upload.file.name,
      bar: { name: 'Upload progress', value: uploadPercent(upload) },
      facts: `${formatFileSize(upload.loaded)} of ${formatFileSize(upload.total)} sent`,
    }
  }
  if (trackingError) {
    return { tone: 'error', label: 'Job unavailable', detail: trackingError }
  }
  if (!status) {
    // A job opened from the address was not uploaded from this page.
    return job.file
      ? { tone: 'busy', label: 'Upload complete', detail: "Waiting for the backend's first status report." }
      : { tone: 'busy', label: 'Checking job', detail: 'Asking the backend for the status of this job.' }
  }

  const stages = stagesText(status)
  const elapsed = `Elapsed ${formatDuration(secondsBetween(status.createdAt, now))}`

  if (status.status === 'queued') {
    return {
      tone: 'busy',
      label: 'Queued',
      detail: 'Waiting for the backend to start the analysis.',
      time: elapsed,
    }
  }
  if (status.status === 'processing') {
    return {
      tone: 'busy',
      label: 'Processing',
      detail: status.currentStage ?? 'Stage not reported',
      bar: { name: 'Analysis progress', value: status.progress },
      facts: stages ? `${stages} stages complete` : null,
      note: 'Progress is reported as each stage starts and ends, so it holds still within a stage',
      time: elapsed,
    }
  }
  if (status.status === 'completed') {
    const took = secondsBetween(status.createdAt, status.updatedAt)
    return {
      tone: 'done',
      label: 'Analysis complete',
      detail: stages ? `${stages} stages complete` : 'Every stage reported complete',
      time: took === null ? null : `Took ${formatDuration(took)}`,
      action: (
        <button
          type="button"
          onClick={onViewResults}
          className="h-8 shrink-0 rounded-md bg-control px-3 text-xs font-semibold text-fg transition-colors hover:bg-control-hover"
        >
          View results
        </button>
      ),
    }
  }
  return {
    tone: 'error',
    label: 'Analysis failed',
    detail: status.error ?? 'The backend reported a failure without a reason.',
    facts: stages ? `Stopped after ${stages} stages` : null,
    note: `pipeline.log is in the backend's jobs/${status.jobId} folder; the API does not serve it`,
  }
}

function ProgressBar({ name, value, fill }: { name: string; value: number | null; fill: string }) {
  return (
    <div className="mt-2.5 flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
      >
        {value !== null && (
          <div
            className={cx(
              'h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
              fill,
            )}
            style={{ width: `${value}%` }}
          />
        )}
      </div>
      <p className="w-9 shrink-0 text-right text-[11px] leading-[14px] font-semibold text-fg-soft tabular-nums">
        {value === null ? '—' : `${Math.round(value)}%`}
      </p>
    </div>
  )
}
