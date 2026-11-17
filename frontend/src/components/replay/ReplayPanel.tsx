import { Film } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { ReplaySource, ReplayVideo } from '../../hooks/useReplayVideo'
import { formatGrouped } from '../../utils/format'

interface ReplayPanelProps {
  replay: ReplayVideo
  /** Receives the <video> element when it appears, and null when it goes. */
  onVideoElement: (video: HTMLVideoElement | null) => void
}

/**
 * Plays the original footage of the analysed job beside its events. It never
 * plays the processed video: that file is mp4v, which Chrome, Edge and Firefox
 * cannot decode, and the API does not serve the uploaded original. So it
 * plays the user's own copy: the file uploaded from this page, or one they
 * choose again, which must have exactly the upload's size.
 */
export function ReplayPanel({ replay, onVideoElement }: ReplayPanelProps) {
  const input = useRef<HTMLInputElement>(null)
  const { source, refusal, upload, canChoose } = replay

  const onChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) replay.choose(file)
    // Clear the input so choosing the same file again still fires a change.
    event.target.value = ''
  }

  return (
    <section aria-label="Replay" className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="px-4 pt-3.5 pb-3">
        <h2 className="text-sm leading-[18px] font-semibold">Replay</h2>
        <p className="mt-0.5 text-[10px] leading-[13px] text-muted">
          The original footage, without the pipeline’s overlays.
        </p>
      </header>

      {source ? (
        // A new source gets a new element, so an error from the last file is forgotten.
        <ReplayPlayer key={source.key} source={source} onVideoElement={onVideoElement} />
      ) : (
        <div className="mx-4 grid aspect-video place-items-center rounded-md border border-dashed border-line-strong bg-ink/60 text-muted">
          <span className="flex flex-col items-center gap-2 text-[11px] leading-[14px]">
            <Film size={20} aria-hidden />
            No video loaded
          </span>
        </div>
      )}

      <div className="space-y-2.5 px-4 pt-3 pb-3.5 text-[11px] leading-[14px]">
        <p className="text-fg-soft">{sourceNote(source, upload, canChoose)}</p>
        {refusal && (
          <p role="alert" className="text-warn">
            {refusal}
          </p>
        )}
        {canChoose && (
          <>
            <input
              ref={input}
              type="file"
              accept="video/mp4,.mp4"
              aria-label="Choose the original video for replay"
              tabIndex={-1}
              onChange={onChosen}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="h-7 rounded-md bg-control px-3 text-xs font-semibold text-fg transition-colors hover:bg-control-hover"
            >
              {source ? 'Choose another copy' : 'Choose video'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}

function ReplayPlayer({
  source,
  onVideoElement,
}: {
  source: ReplaySource
  onVideoElement: (video: HTMLVideoElement | null) => void
}) {
  const [failed, setFailed] = useState(false)
  const video = useRef<HTMLVideoElement | null>(null)
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      video.current = element
      onVideoElement(element)
    },
    [onVideoElement],
  )

  // The blob: URL is made and released here, against the <video> it plays
  // in: the browser's URL registry is the outside system this effect keeps
  // in step. React's development remount runs the cleanup and the setup back
  // to back, which releases the first URL and plays from a fresh one.
  useEffect(() => {
    const element = video.current
    if (!element) return
    const url = URL.createObjectURL(source.file)
    element.src = url
    return () => URL.revokeObjectURL(url)
  }, [source.file])

  return (
    <div className="px-4">
      <video
        ref={attach}
        aria-label={`Replay of ${source.file.name}`}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className="aspect-video w-full rounded-md bg-black object-contain"
      />
      {failed && (
        <p role="alert" className="mt-2 text-[11px] leading-[14px] text-warn">
          This browser cannot play {source.file.name}. Open it in a desktop video player; the event
          times are listed here.
        </p>
      )}
    </div>
  )
}

function sourceNote(
  source: ReplaySource | null,
  upload: ReplayVideo['upload'],
  canChoose: boolean,
): string {
  const size = upload.sizeBytes === null ? null : `${formatGrouped(upload.sizeBytes, 0)} bytes`
  if (!source) {
    if (!canChoose) return 'Preparing the replay.'
    const name = upload.name ?? 'the video that was uploaded'
    return (
      `The backend does not serve the uploaded video, so the replay plays your own copy. ` +
      `Choose ${name}${size ? ` (${size})` : ''} from this computer; it is checked against the ` +
      `upload’s size before it plays.`
    )
  }
  const name = source.file.name
  if (source.origin === 'uploaded') {
    return `Playing ${name}, the video uploaded from this page. The event times were measured on this file.`
  }
  if (source.match === 'same-size') {
    return `Playing ${name} from this computer. It has the same size as the analysed upload (${size}), so the event times should line up.`
  }
  return `Playing ${name} from this computer. The backend did not record the upload’s size, so this copy could not be checked; the event times only line up with the analysed video.`
}
