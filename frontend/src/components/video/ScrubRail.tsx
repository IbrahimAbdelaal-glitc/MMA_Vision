import type { CSSProperties } from 'react'
import { useVideoClock } from '../../hooks/useVideoClock'
import { formatClock } from '../../utils/format'

/**
 * A thin timeline that straddles the bottom edge of the top bar while a
 * recorded video is on screen. It is a native range input, so dragging and
 * the arrow keys both work.
 */
export function ScrubRail({ video }: { video: HTMLVideoElement | null }) {
  const clock = useVideoClock(video)

  if (!video || clock.duration == null || clock.duration <= 0) return null

  const position = clock.currentTime ?? 0
  const progress = (position / clock.duration) * 100

  return (
    <div className="relative z-30 -my-[7px] h-[14px]">
      <input
        type="range"
        className="scrub"
        min={0}
        max={clock.duration}
        step={0.01}
        value={position}
        onChange={(event) => clock.seek(Number(event.target.value))}
        aria-label="Video position"
        aria-valuetext={`${formatClock(position)} of ${formatClock(clock.duration)}`}
        style={{ '--progress': `${progress}%` } as CSSProperties}
      />
    </div>
  )
}
