import type { Artifact, JobResults, JobStatus } from '../types/api'
import { API_PREFIX, errorForStatus, isRecord, readJson, send, unreachableError } from './http'
import {
  normalizeArtifacts,
  normalizeJobStatus,
  normalizeResults,
  normalizeUpload,
} from './normalize'

/*
 * The MMA Vision API, as defined in api/main.py. Every call goes through the
 * dev server's /api proxy, so the browser only ever talks to its own origin.
 */

const JSON_TYPE = 'application/json'

function jobUrl(jobId: string, rest = ''): string {
  return `${API_PREFIX}/jobs/${encodeURIComponent(jobId)}${rest}`
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const { status, body } = await send(url, JSON_TYPE, signal)
  return readJson(status, body)
}

/** GET / : whether the backend is running. */
export async function getHealth(signal?: AbortSignal): Promise<{ version: string | null }> {
  const json = await getJson(`${API_PREFIX}/`, signal)
  return { version: isRecord(json) && typeof json.version === 'string' ? json.version : null }
}

/** GET /jobs/{job_id} */
export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  return normalizeJobStatus(await getJson(jobUrl(jobId), signal))
}

/** GET /jobs/{job_id}/results : the experimental scorecard and its report. */
export async function getJobResults(jobId: string, signal?: AbortSignal): Promise<JobResults> {
  return normalizeResults(await getJson(jobUrl(jobId, '/results'), signal))
}

/** GET /jobs/{job_id}/artifacts : every file the run wrote. */
export async function getJobArtifacts(jobId: string, signal?: AbortSignal): Promise<Artifact[]> {
  return normalizeArtifacts(await getJson(jobUrl(jobId, '/artifacts'), signal))
}

/** The text of a CSV or TXT artifact, from its href. */
export async function getArtifactText(href: string, signal?: AbortSignal): Promise<string> {
  const { status, body } = await send(href, 'text/csv, text/plain, */*', signal)
  if (status < 200 || status > 299) throw errorForStatus(status, body)
  return body
}

export interface UploadOptions {
  /** Bytes sent so far, of the whole request. */
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

/**
 * POST /jobs : uploads an MP4, which starts the nine-stage analysis.
 *
 * XMLHttpRequest is used instead of fetch() because only it reports how much
 * of the request body has been sent, which is what the upload bar shows.
 */
export function uploadVideo(file: File, { onProgress, signal }: UploadOptions = {}): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_PREFIX}/jobs`)
    xhr.setRequestHeader('Accept', JSON_TYPE)

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    })
    xhr.addEventListener('load', () => {
      try {
        resolve(normalizeUpload(readJson(xhr.status, xhr.responseText)))
      } catch (error) {
        reject(error)
      }
    })
    xhr.addEventListener('error', () => reject(unreachableError()))
    xhr.addEventListener('abort', () =>
      reject(new DOMException('The upload was cancelled.', 'AbortError')),
    )
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })

    const form = new FormData()
    form.append('file', file, file.name)
    // No Content-Type header: the browser writes multipart/form-data with the
    // boundary it chose. Setting it by hand would leave the boundary out.
    xhr.send(form)
  })
}
