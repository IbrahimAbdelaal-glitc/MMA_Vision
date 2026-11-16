import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useVideoClock } from './useVideoClock'

/**
 * jsdom has a <video> element but no media engine behind it, so the playback
 * properties are driven by hand here. The hook under test is real.
 */
function videoWith(initial: { duration?: number; currentTime?: number } = {}) {
  const video = document.createElement('video')
  const state = { duration: Number.NaN, currentTime: 0, paused: true, ended: false, ...initial }

  Object.defineProperties(video, {
    duration: { get: () => state.duration },
    currentTime: {
      get: () => state.currentTime,
      set: (value: number) => {
        state.currentTime = value
      },
    },
    paused: { get: () => state.paused },
    ended: { get: () => state.ended },
  })
  video.play = async () => {
    state.paused = false
    video.dispatchEvent(new Event('play'))
  }
  video.pause = () => {
    state.paused = true
    video.dispatchEvent(new Event('pause'))
  }

  return { video, state }
}

describe('useVideoClock', () => {
  it('has no time to report when there is no video', () => {
    const { result } = renderHook(() => useVideoClock(null))

    expect(result.current.currentTime).toBeNull()
    expect(result.current.duration).toBeNull()
    expect(result.current.playing).toBe(false)
  })

  it('reports no duration until the video metadata has loaded', () => {
    const { video, state } = videoWith()
    const { result } = renderHook(() => useVideoClock(video))
    expect(result.current.duration).toBeNull()

    act(() => {
      state.duration = 15
      video.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(result.current.duration).toBe(15)
  })

  it('follows play and pause', () => {
    const { video } = videoWith({ duration: 15 })
    const { result } = renderHook(() => useVideoClock(video))

    act(() => result.current.toggle())
    expect(result.current.playing).toBe(true)

    act(() => result.current.toggle())
    expect(result.current.playing).toBe(false)
  })

  it('reports the new position straight after a seek', () => {
    const { video } = videoWith({ duration: 15 })
    const { result } = renderHook(() => useVideoClock(video))

    act(() => result.current.seek(7.5))

    expect(result.current.currentTime).toBe(7.5)
  })

  it('keeps a seek inside the video', () => {
    const { video, state } = videoWith({ duration: 15 })
    const { result } = renderHook(() => useVideoClock(video))

    act(() => result.current.seek(99))
    expect(state.currentTime).toBe(15)

    act(() => result.current.seek(-5))
    expect(state.currentTime).toBe(0)
  })

  it('stops reporting a time once the video is taken away', () => {
    const { video } = videoWith({ duration: 15, currentTime: 3 })
    const { result, rerender } = renderHook(
      ({ element }: { element: HTMLVideoElement | null }) => useVideoClock(element),
      { initialProps: { element: video as HTMLVideoElement | null } },
    )
    expect(result.current.currentTime).toBe(3)

    rerender({ element: null })

    expect(result.current.currentTime).toBeNull()
  })
})
