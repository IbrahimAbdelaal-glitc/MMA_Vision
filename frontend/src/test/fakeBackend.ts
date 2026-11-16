import { vi } from 'vitest'

/*
 * An in-memory stand-in for the MMA Vision FastAPI backend behind the Vite
 * proxy. It answers fetch() and XMLHttpRequest on the same /api/* paths, with
 * the same status codes and JSON shapes as api/main.py, so the dashboard code
 * runs unchanged against it. Only the network boundary is replaced.
 */

/** One HTTP answer. */
export class FakeReply {
  readonly status: number
  readonly body: string
  readonly contentType: string

  constructor(status: number, body: string, contentType: string) {
    this.status = status
    this.body = body
    this.contentType = contentType
  }
}

export function jsonReply(status: number, data: unknown): FakeReply {
  return new FakeReply(status, JSON.stringify(data), 'application/json')
}

export function textReply(status: number, body: string): FakeReply {
  return new FakeReply(status, body, 'text/plain; charset=utf-8')
}

/** What the Vite dev-server proxy answers when nothing listens at the backend address. */
export const PROXY_FAILURE = new FakeReply(502, '', 'text/plain')

/** GET / on the real backend. */
export const HEALTH = { message: 'MMA Vision API is running.', version: '1.0.0', docs: '/docs' }

/** The ID the fake backend gives an uploaded video unless a test chooses one. */
export const UPLOADED_JOB_ID = '0c8e4f5a-7b2d-4e91-a3f6-5d9b2c1e8a47'

export interface FakeJob {
  /**
   * Answers to GET /jobs/{id}, one per request; the last one keeps repeating.
   * An entry is a status object, or a FakeReply to answer with instead.
   */
  statuses: unknown[]
  /** GET /jobs/{id}/results. Defaults to the backend's 409 "not complete". */
  results?: FakeReply
  /** GET /jobs/{id}/artifacts. Defaults to an empty list. */
  artifacts?: FakeReply
  /** Downloadable files by artifact path, such as "results/movement_report.txt". */
  files?: Record<string, FakeReply>
}

export interface RecordedUpload {
  method: string
  url: string
  /** Headers the page set itself, with lower-case names. */
  headers: Record<string, string>
  /** FormData field names, in order. */
  fields: string[]
  file: File | null
}

export class FakeBackend {
  /** False: every request gets the proxy's 502, as when the backend is stopped. */
  online = true
  /** Every fetch(), as "METHOD /path". */
  readonly requests: string[] = []
  readonly uploads: RecordedUpload[] = []
  /** Set to answer POST /jobs with something other than a new job. */
  uploadReply: FakeReply | 'network-error' | null = null
  /** True: uploads stop at 50 % until releaseUploads() is called. */
  holdUploads = false

  private readonly jobs = new Map<string, FakeJob>()
  private nextUpload: { id: string; job: FakeJob } | null = null
  private readonly heldUploads: Array<() => void> = []

  addJob(id: string, job: FakeJob): this {
    this.jobs.set(id, { ...job, statuses: [...job.statuses] })
    return this
  }

  /** The next accepted upload becomes this job. */
  acceptUploadAs(id: string, job: FakeJob): this {
    this.nextUpload = { id, job }
    return this
  }

  releaseUploads(): void {
    for (const release of this.heldUploads.splice(0)) release()
  }

  /** Replaces the page's fetch and XMLHttpRequest with this backend. */
  install(): this {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => this.fetch(input, init))
    vi.stubGlobal('XMLHttpRequest', xhrClassFor(this))
    return this
  }

  private async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (init?.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')

    this.requests.push(`${method} ${url}`)
    const reply = this.route(method, url)
    return new Response(reply.body, {
      status: reply.status,
      headers: { 'Content-Type': reply.contentType },
    })
  }

  private route(method: string, url: string): FakeReply {
    if (!this.online) return PROXY_FAILURE
    // The proxy forwards only /api/*. Anything else would reach Vite itself.
    if (!url.startsWith('/api/')) return textReply(404, 'Not found')

    const path = url.slice('/api'.length)
    if (method === 'GET' && path === '/') return jsonReply(200, HEALTH)

    const match = /^\/jobs\/([^/]+)(?:\/(results|artifacts|files)(?:\/(.+))?)?$/.exec(path)
    if (method !== 'GET' || !match) return jsonReply(404, { detail: 'Not Found' })

    const [, rawId, resource, filePath] = match
    const job = this.jobs.get(decodeURIComponent(rawId))
    if (!job) return jsonReply(404, { detail: 'Job not found.' })

    if (resource === undefined) {
      const entry = job.statuses.length > 1 ? job.statuses.shift() : job.statuses[0]
      return entry instanceof FakeReply ? entry : jsonReply(200, entry)
    }
    if (resource === 'results') {
      return (
        job.results ??
        jsonReply(409, { detail: 'Analysis is not complete. Current status: processing' })
      )
    }
    if (resource === 'artifacts') {
      return job.artifacts ?? jsonReply(200, { job_id: rawId, total_artifacts: 0, artifacts: [] })
    }
    return job.files?.[filePath ?? ''] ?? jsonReply(404, { detail: 'Artifact not found.' })
  }

  /** POST /jobs, as sent by FakeXhr. */
  handleUpload(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): FakeReply | 'network-error' {
    const form = body instanceof FormData ? body : null
    const file = form?.get('file')
    this.uploads.push({
      method,
      url,
      headers: { ...headers },
      fields: form ? [...form.keys()] : [],
      file: file instanceof File ? file : null,
    })

    if (!this.online) return PROXY_FAILURE
    if (this.uploadReply) return this.uploadReply
    if (method !== 'POST' || url !== '/api/jobs') {
      return jsonReply(405, { detail: 'Method Not Allowed' })
    }

    const accepted = this.nextUpload ?? {
      id: UPLOADED_JOB_ID,
      job: { statuses: [{ job_id: UPLOADED_JOB_ID, status: 'queued', current_stage: 'Queued' }] },
    }
    this.nextUpload = null
    this.addJob(accepted.id, accepted.job)
    return jsonReply(202, {
      message: 'Video uploaded successfully. Analysis started.',
      job_id: accepted.id,
      status: 'queued',
      status_url: `/jobs/${accepted.id}`,
      results_url: `/jobs/${accepted.id}/results`,
    })
  }

  holdUpload(release: () => void): void {
    this.heldUploads.push(release)
  }
}

/** An XMLHttpRequest class whose requests the given backend answers. */
function xhrClassFor(backend: FakeBackend) {
  return class extends FakeXhr {
    constructor() {
      super(backend)
    }
  }
}

/** The part of XMLHttpRequest the dashboard uses, answered by a FakeBackend. */
class FakeXhr extends EventTarget {
  readonly upload = new EventTarget()
  status = 0
  responseText = ''

  private method = ''
  private url = ''
  private readonly headers: Record<string, string> = {}
  private finished = false
  private readonly backend: FakeBackend

  constructor(backend: FakeBackend) {
    super()
    this.backend = backend
  }

  open(method: string, url: string): void {
    this.method = method.toUpperCase()
    this.url = url
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value
  }

  send(body?: unknown): void {
    const file = body instanceof FormData ? body.get('file') : null
    const size = file instanceof File ? file.size : 0
    const progress = (loaded: number) =>
      this.upload.dispatchEvent(
        new ProgressEvent('progress', { lengthComputable: true, loaded, total: size }),
      )

    const finish = () => {
      if (this.finished) return
      this.finished = true
      const reply = this.backend.handleUpload(this.method, this.url, this.headers, body)
      if (reply === 'network-error') {
        this.dispatchEvent(new Event('error'))
        return
      }
      progress(size)
      this.status = reply.status
      this.responseText = reply.body
      this.dispatchEvent(new Event('load'))
    }

    setTimeout(() => {
      if (this.finished) return
      if (this.backend.holdUploads) {
        progress(Math.round(size / 2))
        this.backend.holdUpload(finish)
      } else {
        finish()
      }
    }, 0)
  }

  abort(): void {
    if (this.finished) return
    this.finished = true
    this.dispatchEvent(new Event('abort'))
  }
}
