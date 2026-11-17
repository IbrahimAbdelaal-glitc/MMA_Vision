import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveApi, SocketLike } from './useLiveSession'
import { useLiveSession } from './useLiveSession'

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = []
  readyState = 0
  sent: unknown[] = []
  closedWith: number | null = null
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code = 1000) {
    this.closedWith = code
  }
  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  emit(message: object) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ provisional: true, ...message }) }))
  }
  serverClose(code: number) {
    this.readyState = 3
    this.onclose?.({ code } as CloseEvent)
  }
  clocks() {
    return this.sent.filter((m) => (m as { type: string }).type === 'clock')
  }
}

const VIDEO = { fps: 60, frame_count: 360, width: 1920, height: 1020, duration_seconds: 6, start_offset_ms: 36 }

function fakeVideo() {
  const video = document.createElement('video')
  const state = { currentTime: 0, paused: true, ended: false, duration: 6.036 }
  Object.defineProperty(video, 'currentTime', { get: () => state.currentTime, set: (v: number) => { state.currentTime = v } })
  Object.defineProperty(video, 'paused', { get: () => state.paused })
  Object.defineProperty(video, 'ended', { get: () => state.ended })
  Object.defineProperty(video, 'duration', { get: () => state.duration })
  video.pause = () => {
    state.paused = true
  }
  const play = (t: number) => {
    state.currentTime = t
    state.paused = false
    video.dispatchEvent(new Event('play'))
  }
  return { video, state, play }
}

function fakeApi(overrides: Partial<LiveApi> = {}): LiveApi {
  return {
    create: vi.fn(async () => ({
      sessionId: 's-1',
      video: { fps: 60, frameCount: 360, width: 1920, height: 1020, durationSeconds: 6, startOffsetMs: 36 },
    })),
    analyse: vi.fn(async () => ({ jobId: '0c8e4f5a-7b2d-4e91-a3f6-5d9b2c1e8a47' })),
    remove: vi.fn(async () => {}),
    ...overrides,
  }
}

const file = new File(['x'], 'fight.mp4', { type: 'video/mp4' })

async function startedSession(api = fakeApi(), onHandedOff = vi.fn()) {
  const { video, state, play } = fakeVideo()
  const hook = renderHook(() =>
    useLiveSession({ video, api, onHandedOff, createSocket: (url) => new FakeSocket(url) }),
  )
  await act(async () => hook.result.current.start(file))
  const socket = FakeSocket.all.at(-1)!
  act(() => socket.open())
  return { hook, socket, video, state, play, api, onHandedOff }
}

beforeEach(() => {
  FakeSocket.all = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useLiveSession', () => {
  it('uploads, connects to the session stream and goes live on ready', async () => {
    const { hook, socket, state } = await startedSession()
    expect(socket.url).toMatch(/\/api\/live-sessions\/s-1\/stream$/)
    expect(state.currentTime).toBe(0)
    expect(hook.result.current.state.phase).toBe('starting')
    expect(hook.result.current.state.inference).toBeNull()
    act(() => socket.emit({ type: 'ready', device: 'cuda:0', model: 'yolo11n-pose.pt', inference: 'cuda_graph', video: VIDEO }))
    expect(hook.result.current.state.phase).toBe('live')
    expect(hook.result.current.state.device).toBe('cuda:0')
    expect(hook.result.current.state.inference).toBe('cuda_graph')
  })

  it('sends a clock every 33 ms while playing, so 1x can reach 30 analysed frames/s', async () => {
    vi.useFakeTimers()
    const { socket, play } = await startedSession()
    act(() => play(1.036))
    const before = socket.clocks().length
    act(() => vi.advanceTimersByTime(330))
    expect(socket.clocks().length - before).toBe(10)        // 100 ms would give 3: a 10 /s ceiling
  })

  it('sends the clock in engine time on play, pause and while playing', async () => {
    vi.useFakeTimers()
    const { socket, video, state, play } = await startedSession()
    act(() => play(1.036))
    expect(socket.clocks().at(-1)).toEqual({ type: 'clock', t: 1, playing: true })
    state.currentTime = 1.536
    act(() => vi.advanceTimersByTime(200))
    expect(socket.clocks().at(-1)).toEqual({ type: 'clock', t: 1.5, playing: true })
    act(() => {
      video.pause()
      video.dispatchEvent(new Event('pause'))
    })
    expect(socket.clocks().at(-1)).toEqual({ type: 'clock', t: 1.5, playing: false })
    const count = socket.clocks().length
    act(() => vi.advanceTimersByTime(1000))
    expect(socket.clocks()).toHaveLength(count)            // nothing while paused
  })

  it('reports buffering as not playing until playback resumes', async () => {
    const { socket, video, play } = await startedSession()
    act(() => play(2.036))
    act(() => video.dispatchEvent(new Event('waiting')))
    expect(socket.clocks().at(-1)).toMatchObject({ playing: false })
    act(() => video.dispatchEvent(new Event('playing')))
    expect(socket.clocks().at(-1)).toMatchObject({ playing: true })
  })

  it('keeps frames, events, stats and identity from the engine', async () => {
    const { hook, socket } = await startedSession()
    act(() => {
      socket.emit({ type: 'ready', device: 'cpu' })
      socket.emit({ type: 'frame', t: 0.5, frame_index: 30, corners: { blue: { state: 'tracked', track_id: 1, box: [0, 0, 10, 10], keypoints: [] }, red: { state: 'uncertain' } }, metrics: { fighters_tracked: 1 } })
      socket.emit({ type: 'event', corner: 'blue', side: 'right', strike_type: 'punch-like', peak_t: 0.4, peak_frame: 24, score_status: 'unscored_warm_up', kinematic_score: null, detection_class: null })
      socket.emit({ type: 'stats', frames_analysed: 31, frames_skipped: 0, analysed_rate: 58, detection_active: true, unscored_event_count: 1 })
      socket.emit({ type: 'identity', kind: 'uncertain', corner: 'red', frame: 30, t: 0.5, reason: 'margin' })
    })
    const s = hook.result.current.state
    expect(s.frame?.frameIndex).toBe(30)
    expect(s.cornerStates).toEqual({ blue: 'tracked', red: 'uncertain' })
    expect(s.events).toHaveLength(1)
    expect(s.events[0]).toMatchObject({ scoreStatus: 'unscored_warm_up', kinematicScore: null })
    expect(s.stats?.analysedRate).toBe(58)
    expect(s.identityLog).toEqual([{ kind: 'uncertain', corner: 'red', frame: 30, t: 0.5, reason: 'margin' }])
  })

  it('sends swap and stop, and ends when the engine says so', async () => {
    const { hook, socket } = await startedSession()
    act(() => hook.result.current.swap())
    act(() => hook.result.current.end())
    expect(socket.sent).toContainEqual({ type: 'swap' })
    expect(socket.sent).toContainEqual({ type: 'stop' })
    act(() => {
      socket.emit({ type: 'ended', reason: 'stopped' })
      socket.serverClose(1000)
    })
    expect(hook.result.current.state.phase).toBe('ended')
    expect(hook.result.current.state.endReason).toBe('stopped')
    expect(FakeSocket.all).toHaveLength(1)                  // no reconnect after a normal close
  })

  it('reconnects after an unexpected close and re-sends the clock', async () => {
    vi.useFakeTimers()
    const { hook, socket } = await startedSession()
    act(() => socket.emit({ type: 'ready' }))
    act(() => socket.serverClose(1006))
    expect(hook.result.current.state.connection).toBe('reconnecting')
    act(() => vi.advanceTimersByTime(500))
    const second = FakeSocket.all.at(-1)!
    expect(second).not.toBe(socket)
    act(() => second.open())
    expect(hook.result.current.state.connection).toBe('open')
    expect(second.clocks()).toHaveLength(1)
  })

  it('shows a crash with the engine log and still allows the hand-off', async () => {
    const { hook, socket, api, onHandedOff } = await startedSession()
    act(() => {
      socket.emit({ type: 'error', message: 'the engine exited with code 1', log_tail: ['Traceback ...'] })
      socket.emit({ type: 'ended', reason: 'crashed' })
      socket.serverClose(1000)
    })
    expect(hook.result.current.state.error).toBe('the engine exited with code 1')
    expect(hook.result.current.state.engineLog).toEqual(['Traceback ...'])
    await act(async () => hook.result.current.analyseOffline())
    expect(api.analyse).toHaveBeenCalledWith('s-1')
    expect(onHandedOff).toHaveBeenCalledWith('0c8e4f5a-7b2d-4e91-a3f6-5d9b2c1e8a47', file)
    expect(hook.result.current.state.phase).toBe('idle')
  })

  it('keeps the session when the hand-off fails', async () => {
    const api = fakeApi({ analyse: vi.fn(async () => { throw new Error('The live session could not be handed off: disk full') }) })
    const { hook, socket } = await startedSession(api)
    act(() => socket.emit({ type: 'ended', reason: 'video_end' }))
    await act(async () => hook.result.current.analyseOffline())
    expect(hook.result.current.state.phase).toBe('ended')
    expect(hook.result.current.state.error).toMatch(/disk full/)
  })

  it('reports an unknown session (4404) and a second tab (4409)', async () => {
    const first = await startedSession()
    act(() => first.socket.serverClose(4404))
    expect(first.hook.result.current.state.phase).toBe('idle')
    expect(first.hook.result.current.state.error).toMatch(/no longer has this live session/)
    const second = await startedSession()
    act(() => second.socket.serverClose(4409))
    expect(second.hook.result.current.state.error).toMatch(/another tab/)
  })

  it('shows the verification failure from the upload and starts nothing', async () => {
    const api = fakeApi({ create: vi.fn(async () => { throw new Error('This video cannot be analysed live: T9 failed (30 fps)') }) })
    const { video } = fakeVideo()
    const hook = renderHook(() => useLiveSession({ video, api, createSocket: (url) => new FakeSocket(url) }))
    await act(async () => hook.result.current.start(file))
    expect(hook.result.current.state.phase).toBe('idle')
    expect(hook.result.current.state.error).toMatch(/T9 failed/)
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('discard deletes the session and returns to idle', async () => {
    const { hook, api, socket } = await startedSession()
    await act(async () => hook.result.current.discard())
    expect(api.remove).toHaveBeenCalledWith('s-1')
    expect(socket.closedWith).toBe(1000)
    expect(hook.result.current.state.phase).toBe('idle')
  })

  it('notes a refused backward seek', async () => {
    const { hook, socket } = await startedSession()
    act(() => socket.emit({ type: 'clock_rejected', t: 0.2, position: 3, reason: 'never rewinds' }))
    expect(hook.result.current.state.notice).toMatch(/never goes back/)
  })
})
