import { describe, expect, it } from 'vitest'
import type { LiveEvent, LiveStats } from '../types/live'
import { engineLocation, engineStatusLine, liveTally, toStrikeEvent } from './liveView'

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

describe('engine location text', () => {
  it('names the device and which inference path ran, so a fallback is never silent', () => {
    expect(engineLocation('cuda:0', 'cuda_graph')).toBe(' · GPU (cuda:0) · CUDA graph')
    expect(engineLocation('cuda:0', 'eager')).toBe(' · GPU (cuda:0) · standard inference')
    expect(engineLocation('cpu', 'eager')).toBe(' · CPU · standard inference')
  })

  it('says nothing it does not know', () => {
    expect(engineLocation(null, null)).toBe('')
    expect(engineLocation('cuda:0', null)).toBe(' · GPU (cuda:0)')
  })
})

describe('engine status line (status bar on short overlay screens)', () => {
  const stats = (over: Partial<LiveStats>): LiveStats => ({
    framesAnalysed: 10, framesSkipped: 0, analysedRate: 25, detectionActive: true, detectionInactiveReason: null,
    eventsEmitted: 0, eventsPerMinute: null, eventsPerMinuteBasisSeconds: null, unscoredEventCount: 0,
    heldCandidatesDiscardedByResets: 0, duplicatesDiscarded: 0, positionT: 1, ...over,
  })

  it('says detection is active, the analysed rate and where the engine runs', () => {
    expect(engineStatusLine('cuda:0', 'cuda_graph', stats({}))).toEqual({
      text: 'Detection active · 25.0 frames/s · GPU (cuda:0) · CUDA graph',
      warn: false,
    })
  })

  it('gives the reason when detection is inactive, as a warning', () => {
    const line = engineStatusLine('cpu', 'eager', stats({
      analysedRate: 17.5, detectionActive: false,
      detectionInactiveReason: 'analysed rate 17.5 frames/s is below 20',
    }))
    expect(line).toEqual({
      text: 'Detection inactive: analysed rate 17.5 frames/s is below 20 · 17.5 frames/s · CPU · standard inference',
      warn: true,
    })
  })

  it('is empty before the engine has reported anything', () => {
    expect(engineStatusLine(null, null, null)).toBeNull()
  })
})
