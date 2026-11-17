import { describe, expect, it } from 'vitest'
import { ApiError, errorForStatus, readJson } from './http'

// Regression: a dev server whose /api proxy was not active answered the upload
// with an empty 404 and the health check with index.html. The dashboard said
// "The backend answered with HTTP 404" although the backend never saw either.
describe('answers from the dev server instead of the backend', () => {
  const PAGE = '<!doctype html>\n<html lang="en"><head></head><body></body></html>'

  it('an empty 404 means the /api proxy is not active, not a missing backend route', () => {
    const error = errorForStatus(404, '')
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('unreachable')
    expect(error.message).toMatch(/proxy/i)
    expect(error.message).toMatch(/npm run dev/)
  })

  it('the dashboard page where JSON was expected means the same', () => {
    let caught: unknown
    try {
      readJson(200, PAGE)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).kind).toBe('unreachable')
    expect((caught as ApiError).message).toMatch(/proxy/i)
  })

  it("keeps the backend's own 404 reason", () => {
    const error = errorForStatus(404, JSON.stringify({ detail: 'Job not found.' }))
    expect(error.kind).toBe('http')
    expect(error.message).toBe('Job not found.')
  })

  it('other non-JSON answers stay invalid-response', () => {
    expect(() => readJson(200, 'not json')).toThrow(/not JSON/)
  })
})
