import { describe, expect, it } from 'vitest'
import { formatSecondsTick, highestValue, linePath, nearestIndex, niceTicks } from './chart'

describe('formatSecondsTick', () => {
  it('labels a short axis in seconds', () => {
    expect(formatSecondsTick(0, 14.98)).toBe('0 s')
    expect(formatSecondsTick(2.5, 14.98)).toBe('2.5 s')
    expect(formatSecondsTick(10, 14.98)).toBe('10 s')
  })

  it('labels every tick of an axis of a minute or more as minutes and seconds', () => {
    expect(formatSecondsTick(0, 300)).toBe('0:00')
    expect(formatSecondsTick(60, 300)).toBe('1:00')
    expect(formatSecondsTick(90, 300)).toBe('1:30')
  })
})

describe('niceTicks', () => {
  it('covers the highest value with round steps from zero', () => {
    expect(niceTicks(418.65)).toEqual([0, 100, 200, 300, 400, 500])
    expect(niceTicks(2748.8)).toEqual([0, 1000, 2000, 3000])
    expect(niceTicks(712.9)).toEqual([0, 200, 400, 600, 800])
    expect(niceTicks(0.9)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  it('keeps a scale when every value is zero', () => {
    expect(niceTicks(0)).toEqual([0, 1])
  })
})

describe('highestValue', () => {
  it('finds the largest measured value across every series', () => {
    expect(highestValue([[1, null, 4], [null, 7, 2]])).toBe(7)
  })

  it('is null when nothing was measured', () => {
    expect(highestValue([[null, null], []])).toBeNull()
  })
})

describe('linePath', () => {
  it('draws a line through consecutive points', () => {
    expect(linePath([[0, 10], [5, 20], [10, 15]])).toBe('M0,10L5,20L10,15')
  })

  it('breaks the line where a value is missing, instead of bridging the gap', () => {
    expect(linePath([[0, 10], [5, 20], null, [15, 5], [20, 8]])).toBe('M0,10L5,20M15,5L20,8')
  })

  it('draws a single point between two gaps as a dot', () => {
    expect(linePath([null, [5, 20], null])).toBe('M5,20l0,0')
  })

  it('rounds to a tenth of a pixel', () => {
    expect(linePath([[0.04, 10.06], [5.55, 20]])).toBe('M0,10.1L5.6,20')
  })
})

describe('nearestIndex', () => {
  const times = [0, 0.5, 1, 1.5]

  it('finds the sample closest to a moment', () => {
    expect(nearestIndex(times, 0.7)).toBe(1)
    expect(nearestIndex(times, 0.8)).toBe(2)
  })

  it('clamps to the first and last sample', () => {
    expect(nearestIndex(times, -3)).toBe(0)
    expect(nearestIndex(times, 99)).toBe(3)
  })

  it('is -1 without samples', () => {
    expect(nearestIndex([], 1)).toBe(-1)
  })
})
