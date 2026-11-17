import { useEffect, useState } from 'react'
import { engineTime, isFrameCurrent } from '../../services/liveClock'
import type { Corner } from '../../types/dashboard'
import type { LiveFrame, Keypoint } from '../../types/live'

/** COCO joints drawn for each fighter: shoulders to ankles, as the pipeline records them. */
const BONES: ReadonlyArray<[number, number]> = [
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
]
const JOINTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
const MIN_CONFIDENCE = 0.35

const COLOURS: Record<Corner, string> = {
  blue: 'var(--color-corner-blue)',
  red: 'var(--color-corner-red)',
}

interface LiveOverlayProps {
  frame: LiveFrame | null
  video: HTMLVideoElement | null
  width: number
  height: number
  startOffsetMs: number
  /** One analysed-frame interval: a result older or newer than this is not drawn. */
  intervalSeconds: number
}

function usable(point: Keypoint | undefined): point is [number, number, number] {
  return !!point && point[0] !== null && point[1] !== null && point[2] !== null && point[2] >= MIN_CONFIDENCE
}

/**
 * The live engine's boxes and skeletons over the video, in video pixels.
 * The SVG's viewBox is the video's size and it scales like the video
 * (object-contain), so the drawing stays aligned at any stage size.
 *
 * A result is drawn only while its frame time is within one analysed-frame
 * interval of what the video shows (design 8), so a paused or seeked video
 * never wears a stale skeleton.
 */
export function LiveOverlay({ frame, video, width, height, startOffsetMs, intervalSeconds }: LiveOverlayProps) {
  // 'current': draw it. A number: hidden while playing, this many ms behind
  // the picture (rounded to 50 ms so the text does not re-render every frame).
  const [view, setView] = useState<'current' | 'none' | number>('none')

  // Checked once per displayed frame; React skips the render when nothing changed.
  useEffect(() => {
    if (!frame || !video) return
    let handle = requestAnimationFrame(function check() {
      const shown = engineTime(video.currentTime, startOffsetMs)
      if (isFrameCurrent(frame.t, shown, intervalSeconds)) setView('current')
      else if (!video.paused && shown > frame.t) setView(Math.round(((shown - frame.t) * 1000) / 50) * 50)
      else setView('none')
      handle = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(handle)
  }, [frame, video, startOffsetMs, intervalSeconds])

  if (!frame || !video || view === 'none') return null

  // The engine never analyses beyond the clock the browser last sent (design 8),
  // so while playing its newest result trails the picture. A late skeleton
  // would sit on the wrong pose; say why it is hidden instead.
  if (typeof view === 'number') {
    return (
      <p
        role="status"
        className="pointer-events-none absolute top-16 left-6 z-10 max-w-[288px] rounded-md border border-line-strong bg-hud/90 px-2.5 py-1.5 text-[10px] leading-[13px] text-fg-soft backdrop-blur-sm"
      >
        Pose overlay hidden while playing: the newest result is {view} ms behind the picture. Pause to see it on the current frame.
      </p>
    )
  }

  return (
    <svg
      aria-label="Live pose overlay (provisional)"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 size-full"
    >
      {(['blue', 'red'] as const).map((corner) => {
        const c = frame.corners[corner]
        if (c.state !== 'tracked' || !c.box) return null
        const [x1, y1, x2, y2] = c.box
        const colour = COLOURS[corner]
        const points = c.keypoints ?? []
        const stroke = Math.max(2, width / 640)
        return (
          <g key={corner} data-corner={corner}>
            <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke={colour} strokeWidth={stroke} rx={stroke * 2} opacity={0.85} />
            <text x={x1 + stroke * 2} y={Math.max(y1 - stroke * 3, stroke * 8)} fill={colour} fontSize={stroke * 7} fontWeight={700}>
              {corner === 'blue' ? 'Blue' : 'Red'} · provisional
            </text>
            {BONES.map(([a, b]) => {
              const p = points[a]
              const q = points[b]
              if (!usable(p) || !usable(q)) return null
              return <line key={`${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={colour} strokeWidth={stroke * 1.5} strokeLinecap="round" />
            })}
            {JOINTS.map((j) => {
              const p = points[j]
              return usable(p) ? <circle key={j} cx={p[0]} cy={p[1]} r={stroke * 2} fill={colour} /> : null
            })}
          </g>
        )
      })}
    </svg>
  )
}
