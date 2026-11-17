import type { IdentityCheck, LiveVideo } from '../types/live'
import { API_PREFIX, errorForStatus, readJson, unreachableError } from './http'
import { normalizeIdentityCheck, normalizeLiveSession } from './liveMessages'
import { normalizeUpload } from './normalize'

/*
 * The live-session endpoints in api/live_api.py (design 13). Like the job
 * endpoints, every call goes through the dev server's /api proxy; the
 * WebSocket does too (vite.config.ts proxies it with ws: true).
 */

const JSON_TYPE = 'application/json'

function sessionUrl(sessionId: string, rest = ''): string {
  return `${API_PREFIX}/live-sessions/${encodeURIComponent(sessionId)}${rest}`
}

async function call(method: string, url: string, signal?: AbortSignal): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(url, { method, headers: { Accept: JSON_TYPE }, signal })
    return { status: response.status, body: await response.text() }
  } catch (error) {
    if (signal?.aborted) throw error
    throw unreachableError()
  }
}

export interface LiveUploadOptions {
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

/**
 * POST /live-sessions: uploads the MP4, which the backend verifies (constant
 * 60 fps with real timestamps) before it starts the live engine.
 */
export function createLiveSession(
  file: File,
  { onProgress, signal }: LiveUploadOptions = {},
): Promise<{ sessionId: string; video: LiveVideo }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_PREFIX}/live-sessions`)
    xhr.setRequestHeader('Accept', JSON_TYPE)
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    })
    xhr.addEventListener('load', () => {
      try {
        resolve(normalizeLiveSession(readJson(xhr.status, xhr.responseText)))
      } catch (error) {
        reject(error)
      }
    })
    xhr.addEventListener('error', () => reject(unreachableError()))
    xhr.addEventListener('abort', () => reject(new DOMException('The upload was cancelled.', 'AbortError')))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

/** POST /live-sessions/{id}/analyse: stops the engine, then starts the offline job on the same file. */
export async function analyseLiveSession(sessionId: string): Promise<{ jobId: string }> {
  const { status, body } = await call('POST', sessionUrl(sessionId, '/analyse'))
  return normalizeUpload(readJson(status, body))
}

/** DELETE /live-sessions/{id}: stops the engine and removes the session's files. */
export async function deleteLiveSession(sessionId: string): Promise<void> {
  const { status, body } = await call('DELETE', sessionUrl(sessionId))
  if (status !== 204 && status !== 404) throw errorForStatus(status, body)
}

/** GET /jobs/{id}/identity-check: live corner labels compared with the final ones. */
export async function getIdentityCheck(jobId: string, signal?: AbortSignal): Promise<IdentityCheck> {
  const { status, body } = await call('GET', `${API_PREFIX}/jobs/${encodeURIComponent(jobId)}/identity-check`, signal)
  return normalizeIdentityCheck(readJson(status, body))
}

/** The WebSocket address of a session, on this page's own origin (the dev server proxies it). */
export function liveStreamUrl(sessionId: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}${sessionUrl(sessionId, '/stream')}`
}
