import { describe, expect, it } from 'vitest'
import { compareScores, pointsFor } from './scoring'

describe('compareScores', () => {
  it('names Red when Red has the higher experimental score', () => {
    // The real job: Blue 8, Red 17.
    expect(compareScores(8, 17)).toEqual({ kind: 'higher', corner: 'red', high: 17, low: 8 })
  })

  it('names Blue when Blue has the higher experimental score', () => {
    expect(compareScores(12, 5)).toEqual({ kind: 'higher', corner: 'blue', high: 12, low: 5 })
  })

  it('calls equal scores a tie and names nobody', () => {
    expect(compareScores(8, 8)).toEqual({ kind: 'tie', score: 8 })
  })

  it('compares nothing while either score is missing', () => {
    expect(compareScores(null, 17)).toBeNull()
    expect(compareScores(8, null)).toBeNull()
  })
})

describe('pointsFor', () => {
  it('gives the points of the project scoring rules', () => {
    expect(pointsFor('Very Strong')).toBe(3)
    expect(pointsFor('Strong')).toBe(2)
    expect(pointsFor('Review')).toBe(0)
    expect(pointsFor('Low')).toBe(0)
  })
})
