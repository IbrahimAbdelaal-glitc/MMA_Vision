import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatCount,
  formatDuration,
  formatFileSize,
  formatGrouped,
  formatMeasure,
  formatSigned,
} from './format'

describe('formatClock', () => {
  it.each([
    [0, '00:00.000'],
    [18.42, '00:18.420'],
    [75.5, '01:15.500'],
    [3723.004, '1:02:03.004'],
  ])('formats %s seconds as %s', (seconds, want) => {
    expect(formatClock(seconds)).toBe(want)
  })

  it('carries rounding into the next second instead of printing 1000 ms', () => {
    expect(formatClock(59.9996)).toBe('01:00.000')
  })

  it.each([null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY])(
    'shows a blank clock for %s rather than a made-up time',
    (value) => {
      expect(formatClock(value)).toBe('--:--.---')
    },
  )
})

describe('formatCount', () => {
  it.each([
    [0, '00'],
    [8, '08'],
    [12, '12'],
    [123, '123'],
  ])('pads %s to %s like a scoreboard', (value, want) => {
    expect(formatCount(value)).toBe(want)
  })

  it.each([null, undefined, Number.NaN, -3, 2.5])(
    'shows a dash for %s rather than inventing a count',
    (value) => {
      expect(formatCount(value)).toBe('—')
    },
  )
})

describe('formatMeasure', () => {
  it.each([
    [333.1096, 0, '333'],
    [15.3216, 1, '15.3'],
    [0.937, 2, '0.94'],
    [96.33, 1, '96.3'],
    [2, 0, '2'],
  ])('shows %s with %s decimals as %s', (value, decimals, want) => {
    expect(formatMeasure(value, decimals)).toBe(want)
  })

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'shows a dash for %s rather than a number that was never measured',
    (value) => {
      expect(formatMeasure(value, 1)).toBe('—')
    },
  )
})

describe('formatDuration', () => {
  it.each([
    [0, '00:00'],
    [72.9, '01:12'],
    [213, '03:33'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
  ])('formats %s seconds as %s', (seconds, want) => {
    expect(formatDuration(seconds)).toBe(want)
  })

  it.each([null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY])(
    'shows a blank duration for %s rather than a made-up one',
    (value) => {
      expect(formatDuration(value)).toBe('--:--')
    },
  )
})

describe('formatFileSize', () => {
  it.each([
    [512, '512 B'],
    [1536, '1.5 KB'],
    [15230609, '14.5 MB'],
    [524288000, '500 MB'],
    [1610612736, '1.5 GB'],
  ])('formats %s bytes as %s', (bytes, want) => {
    expect(formatFileSize(bytes)).toBe(want)
  })
})

describe('formatGrouped', () => {
  it.each([
    [2748.7687, 0, '2,749'],
    [3619.37, 2, '3,619.37'],
    [151.73, 2, '151.73'],
    [402.8, 2, '402.80'],
    [15230609, 0, '15,230,609'],
  ])('shows %s with %s decimals and thousands separators as %s', (value, decimals, want) => {
    expect(formatGrouped(value, decimals)).toBe(want)
  })

  it.each([null, undefined, Number.NaN])('shows a dash for %s', (value) => {
    expect(formatGrouped(value, 2)).toBe('—')
  })
})

describe('formatSigned', () => {
  it.each([
    [0.2518, 3, '+0.252'],
    [-0.3394, 3, '−0.339'],
    [-80.964, 2, '−80.96'],
    [0, 3, '0.000'],
    // Rounds to zero: no sign, so it cannot read as a direction.
    [-0.0004, 3, '0.000'],
  ])('shows %s with %s decimals as %s', (value, decimals, want) => {
    expect(formatSigned(value, decimals)).toBe(want)
  })

  it.each([null, undefined, Number.NaN])('shows a dash for %s', (value) => {
    expect(formatSigned(value, 3)).toBe('—')
  })
})
