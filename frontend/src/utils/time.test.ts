import { describe, expect, it } from 'vitest'
import { parseTimestamp, secondsBetween } from './time'

// The real job's status.json timestamps (Python's isoformat, with microseconds).
const CREATED = '2026-11-15T20:11:14.449222+00:00'
const UPDATED = '2026-11-15T20:14:48.219733+00:00'

describe('parseTimestamp', () => {
  it("reads the backend's timestamps, keeping millisecond precision", () => {
    expect(parseTimestamp(CREATED)).toBe(Date.UTC(2026, 10, 15, 20, 11, 14, 449))
  })

  it.each([null, '', 'not a date'])('returns null for %j', (text) => {
    expect(parseTimestamp(text)).toBeNull()
  })
})

describe('secondsBetween', () => {
  it('measures how long the real job took, in whole seconds', () => {
    expect(secondsBetween(CREATED, UPDATED)).toBe(213)
  })

  it('measures up to a moment given in milliseconds', () => {
    expect(secondsBetween(CREATED, Date.UTC(2026, 10, 15, 20, 11, 19, 449))).toBe(5)
  })

  it('never reports a negative time, even when the clocks disagree', () => {
    expect(secondsBetween(UPDATED, CREATED)).toBe(0)
  })

  it('returns null when either moment is unknown', () => {
    expect(secondsBetween(null, UPDATED)).toBeNull()
    expect(secondsBetween(CREATED, null)).toBeNull()
  })
})
