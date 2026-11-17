import { useVideoClock } from '../../hooks/useVideoClock'
import { PLAYHEAD_COLOR } from './series'

interface PlayheadProps {
  video: HTMLVideoElement
  /** Where a moment falls on the chart, or null when it is off the axis. */
  x: (seconds: number) => number | null
  top: number
  bottom: number
}

/**
 * The replay's position as a vertical line inside a chart's SVG. It follows
 * the video by itself, frame by frame, so only this line re-renders while
 * the video plays, not the chart and its hundreds of points.
 */
export function Playhead({ video, x, top, bottom }: PlayheadProps) {
  const { currentTime } = useVideoClock(video)
  const position = currentTime === null ? null : x(currentTime)
  if (position === null) return null
  return (
    <line
      x1={position}
      x2={position}
      y1={top}
      y2={bottom}
      stroke={PLAYHEAD_COLOR}
      strokeWidth={1.5}
      pointerEvents="none"
    />
  )
}
