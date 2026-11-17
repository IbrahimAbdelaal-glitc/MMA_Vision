import { useCallback, useEffect, useState } from 'react'

export interface VideoClock {
  /** Position in seconds, or null when there is no video. */
  currentTime: number | null
  /** Length in seconds, or null until the browser knows it. */
  duration: number | null
  playing: boolean
  toggle: () => void
  seek: (seconds: number) => void
}

interface Reading {
  currentTime: number | null
  duration: number | null
  playing: boolean
}

const NO_VIDEO: Reading = { currentTime: null, duration: null, playing: false }

const VIDEO_EVENTS = [
  'loadedmetadata',
  'durationchange',
  'play',
  'pause',
  'ended',
  'seeked',
  'timeupdate',
  'emptied',
] as const

function readVideo(video: HTMLVideoElement): Reading {
  return {
    currentTime: video.currentTime,
    // duration is NaN until the metadata has loaded.
    duration: Number.isFinite(video.duration) ? video.duration : null,
    playing: !video.paused && !video.ended,
  }
}

/** Moves the playhead, keeping it inside the video. */
function seekVideo(video: HTMLVideoElement, seconds: number) {
  const end = Number.isFinite(video.duration) ? video.duration : 0
  video.currentTime = Math.min(Math.max(seconds, 0), end)
}

/**
 * Follows a <video> element's position, length and play state, and offers
 * play/pause and seeking. Pass null when no video is on screen.
 */
export function useVideoClock(video: HTMLVideoElement | null): VideoClock {
  const [reading, setReading] = useState<Reading>(NO_VIDEO)

  useEffect(() => {
    if (!video) return

    const sync = () => {
      const next = readVideo(video)
      // The frame loop below calls this constantly; keep the previous object
      // when nothing changed so React skips the re-render.
      setReading((previous) =>
        previous.currentTime === next.currentTime &&
        previous.duration === next.duration &&
        previous.playing === next.playing
          ? previous
          : next,
      )
    }

    sync()
    for (const name of VIDEO_EVENTS) video.addEventListener(name, sync)

    // `timeupdate` only fires about four times a second, which makes a
    // millisecond clock visibly stutter. While the video plays, follow the
    // frames instead: requestVideoFrameCallback fires once per frame actually
    // shown. Browsers without it fall back to the screen refresh rate.
    const frameAware = typeof video.requestVideoFrameCallback === 'function'
    let stopped = false
    let frameHandle = 0
    let animationHandle = 0

    const onVideoFrame = () => {
      if (stopped) return
      sync()
      frameHandle = video.requestVideoFrameCallback(onVideoFrame)
    }
    const onAnimationFrame = () => {
      if (stopped) return
      sync()
      if (!video.paused && !video.ended) {
        animationHandle = requestAnimationFrame(onAnimationFrame)
      }
    }
    const startAnimationLoop = () => {
      cancelAnimationFrame(animationHandle)
      animationHandle = requestAnimationFrame(onAnimationFrame)
    }

    if (frameAware) {
      frameHandle = video.requestVideoFrameCallback(onVideoFrame)
    } else {
      video.addEventListener('play', startAnimationLoop)
    }

    return () => {
      stopped = true
      for (const name of VIDEO_EVENTS) video.removeEventListener(name, sync)
      if (frameAware) {
        video.cancelVideoFrameCallback(frameHandle)
      } else {
        video.removeEventListener('play', startAnimationLoop)
        cancelAnimationFrame(animationHandle)
      }
    }
  }, [video])

  const toggle = useCallback(() => {
    if (!video) return
    if (video.paused || video.ended) {
      // play() rejects when the browser refuses or cannot decode the file.
      // The <video> element's own error event is what tells the user.
      void Promise.resolve(video.play()).catch(() => {})
    } else {
      video.pause()
    }
  }, [video])

  const seek = useCallback(
    (seconds: number) => {
      if (!video) return
      seekVideo(video, seconds)
      setReading(readVideo(video))
    },
    [video],
  )

  // Without a video there is nothing to report, whatever was read before.
  const current = video ? reading : NO_VIDEO
  return { ...current, toggle, seek }
}
