/** Every backend request goes through the dev server's /api proxy (vite.config.ts). */
export const API_PREFIX = '/api'

/** The address in .env, used only to tell the user where the dashboard looked. */
const BACKEND_ADDRESS = import.meta.env.VITE_API_BASE_URL as string | undefined

/**
 * When nothing listens at the backend address, the Vite proxy answers 502
 * with an empty body. FastAPI itself never sends these codes without a body.
 */
const PROXY_FAILURES = new Set([502, 503, 504])

export type ApiErrorKind =
  /** Nothing answered: the backend, or the dev server, is not running. */
  | 'unreachable'
  /** The backend answered with an error status. */
  | 'http'
  /** The backend answered, but not in the shape api/main.py defines. */
  | 'invalid-response'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  /** HTTP status of the answer, when there was one. */
  readonly status: number | null

  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

export function unreachableError(): ApiError {
  const where = BACKEND_ADDRESS ? ` at ${BACKEND_ADDRESS}` : ''
  return new ApiError(
    'unreachable',
    `Cannot reach the MMA Vision backend${where}. Check that it is running.`,
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The Vite dev server answered itself because its /api proxy is not active
 * (seen with a long-running dev server: an empty 404 for POST, index.html for
 * GET). FastAPI never sends either, so the backend was not reached at all.
 */
export function proxyInactiveError(): ApiError {
  return new ApiError(
    'unreachable',
    'The dashboard dev server answered instead of the backend: its /api proxy is not active. ' +
      'Stop and restart `npm run dev` in frontend/.',
  )
}

function isDevServerPage(body: string): boolean {
  return /^\s*<(!doctype html|html)/i.test(body)
}

/** The error for an answer outside 200–299, with the backend's own reason when it gave one. */
export function errorForStatus(status: number, body: string): ApiError {
  const json = parseJson(body)
  if (json === undefined && PROXY_FAILURES.has(status)) return unreachableError()
  if (json === undefined && status === 404 && (!body.trim() || isDevServerPage(body))) return proxyInactiveError()
  return new ApiError('http', detailOf(json) ?? `The backend answered with HTTP ${status}.`, status)
}

/** The JSON of a successful answer. Anything else becomes an ApiError. */
export function readJson(status: number, body: string): unknown {
  if (status < 200 || status > 299) throw errorForStatus(status, body)
  const json = parseJson(body)
  if (json === undefined) {
    if (isDevServerPage(body)) throw proxyInactiveError()
    throw new ApiError('invalid-response', 'The backend sent an answer that is not JSON.', status)
  }
  return json
}

/** GETs a URL. A request that cannot be made at all becomes an "unreachable" ApiError. */
export async function send(
  url: string,
  accept: string,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(url, { headers: { ...headers, Accept: accept }, signal })
    return { status: response.status, body: await response.text() }
  } catch (error) {
    // A cancelled request is not a connection problem; let the caller see it as it is.
    if (signal?.aborted) throw error
    throw unreachableError()
  }
}

/** A sentence for the user about what went wrong. */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Something went wrong while talking to the backend.'
}

function parseJson(text: string): unknown {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** FastAPI puts its reason in "detail": a sentence, or a list of validation errors. */
function detailOf(json: unknown): string | null {
  if (!isRecord(json)) return null
  const { detail } = json
  if (typeof detail === 'string') return detail.trim() || null
  // POST /live-sessions answers 422 with {message, rules}.
  if (isRecord(detail) && typeof detail.message === 'string') return detail.message.trim() || null
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) =>
      isRecord(item) && typeof item.msg === 'string' ? [item.msg] : [],
    )
    return messages.length > 0 ? messages.join('; ') : null
  }
  return null
}
