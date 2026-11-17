import { Pause, Play } from 'lucide-react'
import { useVideoClock } from '../../hooks/useVideoClock'
import { formatClock } from '../../utils/format'
import { Readout } from '../common/Readout'

/**
 * The clock in the top bar, with a play/pause button while a recorded video is
 * on screen. It subscribes to the video itself, so the per-frame clock updates
 * re-render only this small component and not the whole dashboard.
 */
export function PlaybackReadout({ video }: { video: HTMLVideoElement | null }) {
  const clock = useVideoClock(video)

  return (
    <div className="flex items-center gap-3">
      {video && (
        <button
          type="button"
          onClick={clock.toggle}
          aria-label={clock.playing ? 'Pause video' : 'Play video'}
          className="grid size-8 place-items-center rounded-full bg-control text-fg transition-colors hover:bg-control-hover"
        >
          {clock.playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        </button>
      )}
      <Readout label={video ? 'Video time' : 'Elapsed'} value={formatClock(clock.currentTime)} />
    </div>
  )
}
