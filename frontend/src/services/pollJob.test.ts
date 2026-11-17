import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPLETED_STATUS,
  FAILED_STATUS,
  JOB_ID,
  PROCESSING_STATUS,
  QUEUED_STATUS,
} from '../test/fixtures/realJob'
import type { JobStatus } from '../types/api'
import { ApiError, unreachableError } from './http'
import { normalizeJobStatus } from './normalize'
import { POLL_INTERVAL_MS, pollJob } from './pollJob'

const queued = normalizeJobStatus(QUEUED_STATUS)
const processing = normalizeJobStatus(PROCESSING_STATUS)
const completed = normalizeJobStatus(COMPLETED_STATUS)
const failed = normalizeJobStatus(FAILED_STATUS)

/** A status endpoint answering each request with the next entry. An Error entry is thrown. */
function statusEndpoint(...answers: Array<JobStatus | Error>) {
  return vi.fn(async () => {
    const answer = answers.length > 1 ? answers.shift() : answers[0]
    if (answer === undefined) throw new Error('No answer left')
    if (answer instanceof Error) throw answer
    return answer
  })
}

function poll(getStatus: ReturnType<typeof statusEndpoint>, signal = new AbortController().signal) {
  const seen: string[] = []
  const retries: ApiError[] = []
  const done = pollJob(JOB_ID, {
    getStatus,
    signal,
    onStatus: (status) => seen.push(status.status),
    onRetry: (error) => retries.push(error),
  })
  // Keep an early rejection from being reported before the test awaits it.
  done.catch(() => {})
  return { done, seen, retries }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pollJob', () => {
  it('asks every 2–3 seconds while the job is queued or processing, then stops', async () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000)
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(3000)
    const getStatus = statusEndpoint(queued, processing, processing, completed)

    const { done, seen } = poll(getStatus)

    await vi.advanceTimersByTimeAsync(0)
    expect(getStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1)
    expect(getStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getStatus).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    await expect(done).resolves.toEqual(completed)
    expect(seen).toEqual(['queued', 'processing', 'processing', 'completed'])

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4)
    expect(getStatus).toHaveBeenCalledTimes(4)
  })

  it('stops when the job fails', async () => {
    const getStatus = statusEndpoint(processing, failed)

    const { done } = poll(getStatus)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4)

    await expect(done).resolves.toEqual(failed)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps asking through a connection problem and reports it', async () => {
    const getStatus = statusEndpoint(unreachableError(), processing, completed)

    const { done, seen, retries } = poll(getStatus)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

    await expect(done).resolves.toEqual(completed)
    expect(retries.map((error) => error.kind)).toEqual(['unreachable'])
    expect(seen).toEqual(['processing', 'completed'])
  })

  it('gives up on a job the backend does not know', async () => {
    const notFound = new ApiError('http', 'Job not found.', 404)
    const getStatus = statusEndpoint(notFound)

    const { done } = poll(getStatus)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

    await expect(done).rejects.toBe(notFound)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('stops asking once it is cancelled', async () => {
    const controller = new AbortController()
    const getStatus = statusEndpoint(processing)

    const { done } = poll(getStatus, controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('waits for a slow answer before asking again, so requests never pile up', async () => {
    const getStatus = vi
      .fn<() => Promise<JobStatus>>()
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(processing), 10_000)),
      )
      .mockResolvedValue(completed)

    const { done } = poll(getStatus)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(getStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000 + POLL_INTERVAL_MS)
    expect(getStatus).toHaveBeenCalledTimes(2)
    await expect(done).resolves.toEqual(completed)
  })
})
