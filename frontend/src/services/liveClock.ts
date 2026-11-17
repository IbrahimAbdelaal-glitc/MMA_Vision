/*
 * Browser playback time vs. the engine's verified video time (design 6.5, 8).
 *
 * Measured in Chrome with requestVideoFrameCallback on both real clips:
 * mediaTime of frame i is t_i + start offset (the 6 s clip's first frame is
 * presented at 0.036 s, and every one of its 360 frames is exactly
 * 0.036 + i/60), and frame i is on screen while currentTime - offset lies in
 * [i/60, (i+1)/60). So the engine time is currentTime minus the offset.
 */

export interface ClockMessage {
  type: 'clock'
  t: number
  playing: boolean
}

/** The engine's video time for the browser's currentTime. */
export function engineTime(currentTime: number, startOffsetMs: number): number {
  return Math.max(0, currentTime - startOffsetMs / 1000)
}

/**
 * The clock message for the video's state now. `waiting` is true while the
 * browser is buffering (after a `waiting` event, until `playing`).
 */
export function clockMessage(
  video: Pick<HTMLVideoElement, 'currentTime' | 'duration' | 'paused' | 'ended'>,
  startOffsetMs: number,
  waiting: boolean,
): ClockMessage {
  if (video.ended && Number.isFinite(video.duration)) {
    // Design 8: on `ended`, t is the video's duration (here, in engine time).
    return { type: 'clock', t: engineTime(video.duration, startOffsetMs), playing: true }
  }
  return {
    type: 'clock',
    t: engineTime(video.currentTime, startOffsetMs),
    playing: !video.paused && !video.ended && !waiting,
  }
}

/**
 * Design 8, display: a frame result is drawn only while its time is within
 * one analysed-frame interval of what the video shows.
 */
export function isFrameCurrent(frameT: number, videoT: number, intervalSeconds: number): boolean {
  return Math.abs(videoT - frameT) <= intervalSeconds + 1e-6
}

/** One analysed-frame interval: from the measured analysed rate, at least one video frame. */
export function analysedInterval(analysedRate: number | null, fps: number): number {
  const frame = 1 / fps
  if (analysedRate === null || analysedRate <= 0) return 0.25
  return Math.max(frame, Math.min(0.25, 1 / analysedRate))
}
