import { describe, expect, it } from 'vitest'
import { seekTo } from './seek'

/** A stand-in <video> whose length is known or not, recording where it was sent. */
function fakeVideo(duration: number) {
  return { duration, currentTime: 0 } as HTMLVideoElement
}

describe('seekTo', () => {
  it('goes to the requested time', () => {
    const video = fakeVideo(14.98)
    seekTo(video, 1.15)
    expect(video.currentTime).toBe(1.15)
  })

  it('keeps the time inside the video once its length is known', () => {
    const video = fakeVideo(14.98)
    seekTo(video, 20)
    expect(video.currentTime).toBe(14.98)
    seekTo(video, -1)
    expect(video.currentTime).toBe(0)
  })

  it('still seeks before the length is known, instead of snapping to the start', () => {
    // duration is NaN until the metadata has loaded; the browser applies the
    // position once it can.
    const video = fakeVideo(Number.NaN)
    seekTo(video, 1.15)
    expect(video.currentTime).toBe(1.15)
  })
})
