import { FileVideo, TriangleAlert } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import type { LocalVideoSource } from '../../types/dashboard'
import { cx } from '../../utils/cx'

interface VideoStageProps {
  source: LocalVideoSource | null
  /** Called with the <video> element when it appears and with null when it goes. */
  onVideoElement: (element: HTMLVideoElement | null) => void
  onSelectVideo: () => void
  onDropFile: (file: File) => void
}

/**
 * The central stage. It shows the chosen video, or an invitation to choose
 * one. Tracking overlays are drawn here only when real analysis supplies them.
 */
export function VideoStage({ source, onVideoElement, onSelectVideo, onDropFile }: VideoStageProps) {
  const [dragging, setDragging] = useState(false)

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    // Without preventDefault the browser refuses the drop and opens the file itself.
    event.preventDefault()
    setDragging(true)
  }

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    // dragleave also fires when the pointer moves onto a child element.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragging(false)
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onDropFile(file)
  }

  return (
    <section
      aria-label="Video stage"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      // Stacked: a 16:9 box, capped so the HUDs below stay within reach (and
      // never too short for the "select a video" invitation on a phone).
      // Overlay: stretched behind the whole grid.
      className={cx(
        'area-stage relative aspect-video max-h-[62dvh] w-full overflow-hidden rounded-lg bg-ink overlay:absolute overlay:inset-0 overlay:-z-10 overlay:aspect-auto overlay:max-h-none overlay:min-h-0 overlay:rounded-none',
        !source && 'min-h-[280px]',
      )}
    >
      {source ? (
        // The key gives each new file a fresh element, so a playback error
        // from the previous file cannot linger.
        <SourceVideo key={source.url} source={source} onVideoElement={onVideoElement} />
      ) : (
        <EmptyStage onSelectVideo={onSelectVideo} />
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-lg border-2 border-dashed border-corner-blue bg-corner-blue/10 text-sm font-semibold">
          Drop the MP4 to preview it
        </div>
      )}
    </section>
  )
}

function SourceVideo({
  source,
  onVideoElement,
}: {
  source: LocalVideoSource
  onVideoElement: (element: HTMLVideoElement | null) => void
}) {
  const [failed, setFailed] = useState(false)

  return (
    <>
      <video
        ref={onVideoElement}
        src={source.url}
        aria-label="Fight video"
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        onClick={(event) => {
          const video = event.currentTarget
          if (video.paused || video.ended) {
            void Promise.resolve(video.play()).catch(() => {})
          } else {
            video.pause()
          }
        }}
        className="absolute inset-0 size-full cursor-pointer bg-black object-contain"
      />

      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-ink/90 p-6 text-center overlay:pb-44">
          <div className="max-w-sm">
            <TriangleAlert size={22} aria-hidden className="mx-auto text-warn" />
            <p className="mt-3 text-sm font-semibold">This browser cannot play this video</p>
            <p className="mt-1.5 text-xs leading-[18px] text-muted">
              The file may use a codec browsers do not support. MP4 files encoded with H.264 do
              play. The file itself has not been changed.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function EmptyStage({ onSelectVideo }: { onSelectVideo: () => void }) {
  return (
    <div className="stage-backdrop absolute inset-0 grid place-items-center p-6 overlay:pb-44">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-line-strong bg-hud text-fg-soft">
          <FileVideo size={22} aria-hidden />
        </span>
        <h1 className="mt-4 text-[22px] leading-[27px] font-bold">Select a fight video</h1>
        <p className="mt-2 text-xs leading-[18px] text-muted">
          MP4, up to 500 MB. It plays here as a preview first. Nothing is uploaded until you
          choose Analyse video.
        </p>
        <button
          type="button"
          onClick={onSelectVideo}
          className="mt-5 h-9 rounded-md bg-control px-4 text-[13px] font-semibold text-fg transition-colors hover:bg-control-hover"
        >
          Select MP4
        </button>
        <p className="mt-3 text-[11px] leading-[14px] text-muted">
          or drop a file anywhere on this area
        </p>
      </div>
    </div>
  )
}
