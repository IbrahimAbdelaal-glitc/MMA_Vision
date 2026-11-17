import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from 'react'
import { getJobStatus, uploadVideo } from '../services/api'
import { ApiError, messageOf } from '../services/http'
import { loadAnalysis } from '../services/loadAnalysis'
import { isJobId } from '../services/normalize'
import { pollJob } from '../services/pollJob'
import type { AnalysisData, JobStatus } from '../types/api'

export interface UploadProgress {
  file: File
  /** Bytes of the request sent so far, and in total (slightly more than the file). */
  loaded: number
  total: number
}

export type AnalysisLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'loaded'; data: AnalysisData }

export interface JobState {
  /** The upload in progress, if any. */
  upload: UploadProgress | null
  /** Why the last upload failed. */
  uploadError: string | null
  /** The job being followed: uploaded from this page, or opened from ?job= in the address. */
  jobId: string | null
  /** The file uploaded for this job. Null for a job opened from the address. */
  file: File | null
  /** The latest status the backend reported. */
  status: JobStatus | null
  /** The last status check failed and is being retried. */
  connectionError: { message: string; unreachable: boolean } | null
  /** The job can no longer be followed, for example because the backend does not know it. */
  trackingError: string | null
  /** The results of a completed job. */
  analysis: AnalysisLoad
  /** Raised by retryAnalysis() to load the results again. */
  analysisAttempt: number
}

const NO_JOB: JobState = {
  upload: null,
  uploadError: null,
  jobId: null,
  file: null,
  status: null,
  connectionError: null,
  trackingError: null,
  analysis: { state: 'idle' },
  analysisAttempt: 0,
}

type Action =
  | { type: 'upload-started'; file: File }
  | { type: 'upload-progress'; loaded: number; total: number }
  | { type: 'upload-failed'; message: string }
  | { type: 'job-started'; jobId: string; file: File | null }
  | { type: 'status'; status: JobStatus }
  | { type: 'connection-lost'; message: string; unreachable: boolean }
  | { type: 'tracking-stopped'; message: string }
  | { type: 'analysis-loading' }
  | { type: 'analysis-loaded'; data: AnalysisData }
  | { type: 'retry-analysis' }
  | { type: 'dismiss-upload-error' }

function reducer(state: JobState, action: Action): JobState {
  switch (action.type) {
    case 'upload-started':
      // The job shown so far stays until the backend accepts the new upload.
      return {
        ...state,
        upload: { file: action.file, loaded: 0, total: action.file.size },
        uploadError: null,
      }
    case 'upload-progress':
      return state.upload
        ? { ...state, upload: { ...state.upload, loaded: action.loaded, total: action.total } }
        : state
    case 'upload-failed':
      return { ...state, upload: null, uploadError: action.message }
    case 'job-started':
      return { ...NO_JOB, jobId: action.jobId, file: action.file }
    case 'status':
      return { ...state, status: action.status, connectionError: null }
    case 'connection-lost':
      return {
        ...state,
        connectionError: { message: action.message, unreachable: action.unreachable },
      }
    case 'tracking-stopped':
      return { ...state, connectionError: null, trackingError: action.message }
    case 'analysis-loading':
      return { ...state, analysis: { state: 'loading' } }
    case 'analysis-loaded':
      return { ...state, analysis: { state: 'loaded', data: action.data } }
    case 'retry-analysis':
      return { ...state, analysisAttempt: state.analysisAttempt + 1 }
    case 'dismiss-upload-error':
      return { ...state, uploadError: null }
  }
}

/** A job named in the address (?job=<id>) is picked up again, so a reload loses nothing. */
function initialState(): JobState {
  const requested = new URLSearchParams(window.location.search).get('job')
  if (requested === null) return NO_JOB
  return isJobId(requested)
    ? { ...NO_JOB, jobId: requested }
    : { ...NO_JOB, trackingError: 'The job ID in the address is not valid.' }
}

/** True while an upload or an unfinished job is in progress. One analysis runs at a time. */
export function isJobActive(state: JobState): boolean {
  if (state.upload) return true
  if (!state.jobId || state.trackingError) return false
  return (
    state.status === null || state.status.status === 'queued' || state.status.status === 'processing'
  )
}

export function uploadPercent(upload: UploadProgress): number {
  return upload.total > 0 ? Math.min(100, Math.round((upload.loaded / upload.total) * 100)) : 0
}

function trackingMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'http' && error.status === 404) {
    return 'The backend has no job with this ID.'
  }
  return messageOf(error)
}

function failedEverywhere(message: string): AnalysisData {
  const failed = { state: 'error', message } as const
  return {
    results: failed,
    artifacts: failed,
    classification: failed,
    events: failed,
    direction: failed,
    movement: failed,
    movementReport: failed,
  }
}

interface Options {
  /** Called once when a followed job reaches "completed". */
  onCompleted?: (jobId: string) => void
}

/**
 * One analysis job, from upload to results.
 *
 * analyse(file) uploads the video to POST /jobs. The job's status is then
 * checked every 2.5 s until it is completed or failed, and a completed job's
 * results, file list and class counts are loaded. Everything shown comes from
 * the backend; between two status checks nothing is estimated.
 */
export function useAnalysisJob({ onCompleted }: Options = {}) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const uploadController = useRef<AbortController | null>(null)

  // Lets the polling effect call the latest callback without restarting.
  const notifyCompleted = useEffectEvent((jobId: string) => onCompleted?.(jobId))

  const analyse = useCallback((file: File) => {
    uploadController.current?.abort()
    const controller = new AbortController()
    uploadController.current = controller

    dispatch({ type: 'upload-started', file })
    uploadVideo(file, {
      signal: controller.signal,
      onProgress: (loaded, total) => dispatch({ type: 'upload-progress', loaded, total }),
    }).then(
      ({ jobId }) => {
        if (!controller.signal.aborted) dispatch({ type: 'job-started', jobId, file })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) dispatch({ type: 'upload-failed', message: messageOf(error) })
      },
    )
  }, [])

  const retryAnalysis = useCallback(() => dispatch({ type: 'retry-analysis' }), [])
  const dismissUploadError = useCallback(() => dispatch({ type: 'dismiss-upload-error' }), [])

  // An upload still running when the dashboard closes is cancelled.
  useEffect(() => () => uploadController.current?.abort(), [])

  // Keep ?job= in the address in step with the job being followed.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (state.jobId) url.searchParams.set('job', state.jobId)
    else url.searchParams.delete('job')
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
  }, [state.jobId])

  // Follow the job until the backend says it is completed or failed.
  useEffect(() => {
    const jobId = state.jobId
    if (!jobId) return
    const controller = new AbortController()

    pollJob(jobId, {
      getStatus: getJobStatus,
      signal: controller.signal,
      onStatus: (status) => dispatch({ type: 'status', status }),
      onRetry: (error) =>
        dispatch({
          type: 'connection-lost',
          message: error.message,
          unreachable: error.kind === 'unreachable',
        }),
    }).then(
      (status) => {
        if (!controller.signal.aborted && status.status === 'completed') notifyCompleted(jobId)
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'tracking-stopped', message: trackingMessage(error) })
        }
      },
    )
    return () => controller.abort()
  }, [state.jobId])

  // Load the results once the job is completed, and again on retry.
  const completed = state.status?.status === 'completed'
  useEffect(() => {
    const jobId = state.jobId
    if (!jobId || !completed) return
    const controller = new AbortController()

    dispatch({ type: 'analysis-loading' })
    loadAnalysis(jobId, controller.signal).then(
      (data) => dispatch({ type: 'analysis-loaded', data }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'analysis-loaded', data: failedEverywhere(messageOf(error)) })
        }
      },
    )
    return () => controller.abort()
  }, [state.jobId, completed, state.analysisAttempt])

  return { state, analyse, retryAnalysis, dismissUploadError }
}
