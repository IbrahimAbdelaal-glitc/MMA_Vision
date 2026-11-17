/**
 * Moves a video to `seconds`. Once the video's length is known the time is
 * kept inside it; before that (duration is NaN until the metadata loads) the
 * browser holds the position and applies it when it can, so the request is
 * passed on rather than snapped to the start.
 */
export function seekTo(video: HTMLVideoElement, seconds: number): void {
  const end = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY
  video.currentTime = Math.min(Math.max(seconds, 0), end)
}
