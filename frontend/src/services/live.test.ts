import { describe, expect, it } from 'vitest'
import { errorForStatus } from './http'
import { liveStreamUrl } from './liveApi'
import { analysedInterval, clockMessage, engineTime, isFrameCurrent } from './liveClock'
import { normalizeEngineMessage, normalizeIdentityCheck, normalizeLiveSession } from './liveMessages'

describe('engine clock mapping (measured in Chrome)', () => {
  it('subtracts the start offset and never goes below zero', () => {
    expect(engineTime(0.036 + 30 / 60, 36)).toBeCloseTo(0.5, 9)
    expect(engineTime(0, 36)).toBe(0)
    expect(engineTime(2.5, 0)).toBe(2.5)
  })

  it('reports playing only while the video plays and is not buffering', () => {
    const video = { currentTime: 1.036, duration: 6.036, paused: false, ended: false }
    expect(clockMessage(video, 36, false)).toEqual({ type: 'clock', t: 1, playing: true })
    expect(clockMessage(video, 36, true).playing).toBe(false)
    expect(clockMessage({ ...video, paused: true }, 36, false).playing).toBe(false)
  })

  it('sends the duration on ended, so the engine can reach the last frame', () => {
    const ended = { currentTime: 6.036, duration: 6.036, paused: true, ended: true }
    expect(clockMessage(ended, 36, false)).toEqual({ type: 'clock', t: 6, playing: true })
  })

  it('draws a frame result only within one analysed interval of the video', () => {
    expect(isFrameCurrent(1.0, 1.1, 0.1)).toBe(true)
    expect(isFrameCurrent(1.0, 1.11, 0.1)).toBe(false)
    expect(isFrameCurrent(1.0, 0.95, 0.1)).toBe(true)
    expect(analysedInterval(null, 60)).toBe(0.25)
    expect(analysedInterval(60, 60)).toBeCloseTo(1 / 60)
    expect(analysedInterval(6, 60)).toBeCloseTo(1 / 6)
    expect(analysedInterval(2, 60)).toBe(0.25)
  })
})

describe('engine messages', () => {
  it('keeps the inference path from ready and drops unknown values', () => {
    expect(normalizeEngineMessage({ type: 'ready', device: 'cuda:0', model: 'm', inference: 'cuda_graph' }))
      .toEqual({ type: 'ready', device: 'cuda:0', model: 'm', inference: 'cuda_graph' })
    expect(normalizeEngineMessage({ type: 'ready', device: 'cpu', inference: 'eager' }))
      .toMatchObject({ inference: 'eager' })
    expect(normalizeEngineMessage({ type: 'ready', inference: 'turbo' })).toMatchObject({ inference: null })
    expect(normalizeEngineMessage({ type: 'ready' })).toMatchObject({ inference: null })
  })

  it('normalises a frame and keeps unmeasured values null', () => {
    const message = normalizeEngineMessage({
      type: 'frame', t: 0.5, frame_index: 30, provisional: true,
      corners: {
        blue: { state: 'tracked', track_id: 1, box: [1, 2, 3, 4], keypoints: [[1, 2, 0.9]] },
        red: { state: 'lost' },
      },
      metrics: { distance_px: null, fighters_tracked: 1, keypoint_confidence: 0.8 },
    })
    expect(message?.type).toBe('frame')
    if (message?.type !== 'frame') return
    expect(message.frame.corners.blue).toEqual({ state: 'tracked', trackId: 1, box: [1, 2, 3, 4], keypoints: [[1, 2, 0.9]] })
    expect(message.frame.corners.red.box).toBeNull()
    expect(message.frame.metrics.distancePx).toBeNull()
    expect(message.frame.metrics.blueSpeedPxPerSecond).toBeNull()
    expect(message.frame.metrics.fightersTracked).toBe(1)
  })

  it('keeps an unscored event unscored even if a score were sent', () => {
    const message = normalizeEngineMessage({
      type: 'event', corner: 'red', side: 'left', strike_type: 'kick-like', peak_t: 2.1, peak_frame: 126,
      score_status: 'unscored_warm_up', kinematic_score: 88, detection_class: 'Very Strong',
    })
    expect(message).toMatchObject({ type: 'event', event: { corner: 'red', scoreStatus: 'unscored_warm_up', kinematicScore: null, detectionClass: null } })
  })

  it('reads a scored event', () => {
    const message = normalizeEngineMessage({
      type: 'event', corner: 'blue', side: 'right', strike_type: 'punch-like', peak_t: 1.2, peak_frame: 72,
      score_status: 'scored', kinematic_score: 71.5, detection_class: 'Strong', pool_size: 5,
    })
    expect(message).toMatchObject({ event: { kinematicScore: 71.5, detectionClass: 'Strong', poolSize: 5 } })
  })

  it('rejects malformed messages and unknown end reasons', () => {
    expect(normalizeEngineMessage({ type: 'frame', t: 'x' })).toBeNull()
    expect(normalizeEngineMessage({ type: 'mystery' })).toBeNull()
    expect(normalizeEngineMessage('nope')).toBeNull()
    expect(normalizeEngineMessage({ type: 'ended', reason: 'odd' })).toEqual({ type: 'ended', reason: 'crashed' })
  })

  it('reads the session answer and the identity check', () => {
    expect(normalizeLiveSession({
      session_id: 'abc', video: { fps: 60, frame_count: 360, width: 1920, height: 1020, duration_seconds: 6, start_offset_ms: 36 },
    })).toEqual({ sessionId: 'abc', video: { fps: 60, frameCount: 360, width: 1920, height: 1020, durationSeconds: 6, startOffsetMs: 36 } })
    expect(() => normalizeLiveSession({ session_id: 'abc' })).toThrow()
    const check = normalizeIdentityCheck({
      state: 'disagree', compared_seconds: 4.7, not_compared_seconds: { ambiguous: 0.4 },
      intervals: [{ start: 2.4, end: 4.1, not_compared_seconds: 0.2, identity_log_entry: 're-association at 2.40 s' }],
    })
    expect(check.state).toBe('disagree')
    expect(check.notComparedSeconds).toEqual({ ambiguous: 0.4, live_uncertain: 0, live_lost: 0, offline_missing: 0 })
    expect(check.intervals[0].identityLogEntry).toBe('re-association at 2.40 s')
  })
})

describe('live API helpers', () => {
  it('shows the verification message from a 422 body', () => {
    const error = errorForStatus(422, JSON.stringify({ detail: { message: 'This video cannot be analysed live: T9 failed', rules: {} } }))
    expect(error.message).toBe('This video cannot be analysed live: T9 failed')
  })

  it('builds the WebSocket address on the page origin', () => {
    expect(liveStreamUrl('s1', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/api/live-sessions/s1/stream')
    expect(liveStreamUrl('s1', { protocol: 'https:', host: 'x' })).toBe('wss://x/api/live-sessions/s1/stream')
  })
})
