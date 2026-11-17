import { describe, expect, it } from 'vitest'
import type { LiveEvent } from '../types/live'
import { liveTally, toStrikeEvent } from './liveView'

function event(overrides: Partial<LiveEvent>): LiveEvent {
  return {
    id: 'live-1', corner: 'blue', side: 'right', type: 'punch-like', peakT: 1, peakFrame: 60,
    smoothedPeakSpeed: 900, keypointConfidence: 0.9, poolSize: 5, scoreStatus: 'scored',
    kinematicScore: 70, detectionClass: 'Strong', ...overrides,
  }
}

describe('live view helpers', () => {
  it('counts each corner separately, unscored events in the total only', () => {
    const events = [
      event({ detectionClass: 'Very Strong' }),
      event({ type: 'kick-like', detectionClass: 'Strong' }),
      event({ scoreStatus: 'unscored_warm_up', detectionClass: null, kinematicScore: null }),
      event({ corner: 'red', detectionClass: 'Review' }),
    ]
    expect(liveTally(events, 'blue')).toEqual({ totalEvents: 3, punchLike: 2, kickLike: 1, strong: 1, veryStrong: 1 })
    expect(liveTally(events, 'red')).toEqual({ totalEvents: 1, punchLike: 1, kickLike: 0, strong: 0, veryStrong: 0 })
  })

  it('marks converted events provisional and keeps unscored values null', () => {
    const converted = toStrikeEvent(event({ scoreStatus: 'unscored_warm_up', detectionClass: null, kinematicScore: null }))
    expect(converted).toMatchObject({ provisional: true, detectionClass: null, kinematicScore: null, timeSeconds: 1 })
  })
})
