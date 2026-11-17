import type { JobStatus } from '../types/api'
import { ApiError } from './http'

/** How often the job status is checked while the backend works: within the 2–3 s asked for. */
export const POLL_INTERVAL_MS = 2500

export interface PollOptions {
  getStatus: (jobId: string, signal: AbortSignal) => Promise<JobStatus>
  signal: AbortSignal
  /** Every status the backend reports, in order. */
  onStatus: (status: JobStatus) => void
  /** A request failed in a way worth retrying, such as a lost connection. */
  onRetry: (error: ApiError) => void
  intervalMs?: number
}

/**
 * Checks the job status until the backend reports "completed" or "failed",
 * and resolves with that final status.
 *
 * The next request is scheduled only after the previous one has finished
 * (a setTimeout chain rather than setInterval), so slow answers never pile up.
 * A lost connection or a server error is retried; an answer that proves the
 * job cannot be followed (404, 400, or an answer in the wrong shape) ends the
 * polling with that error.
 */
export async function pollJob(jobId: string, options: PollOptions): Promise<JobStatus> {
  const { getStatus, signal, onStatus, onRetry, intervalMs = POLL_INTERVAL_MS } = options

  for (;;) {
    try {
      const status = await getStatus(jobId, signal)
      onStatus(status)
      if (status.status === 'completed' || status.status === 'failed') return status
    } catch (error) {
      if (signal.aborted || !(error instanceof ApiError) || isFinal(error)) throw error
      onRetry(error)
    }
    await wait(intervalMs, signal)
  }
}

function isFinal(error: ApiError): boolean {
  if (error.kind === 'invalid-response') return true
  return error.kind === 'http' && error.status !== null && error.status >= 400 && error.status < 500
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
