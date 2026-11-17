import { Film } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { ReplaySource, ReplayVideo } from '../../hooks/useReplayVideo'
import { checkProcessedVideo, processedVideoUrl } from '../../services/api'
import { messageOf } from '../../services/http'
import { formatGrouped } from '../../utils/format'
import { seekTo } from '../../utils/seek'
import { Segmented } from '../common/Segmented'

/**
 * What the backend can replay for this job.
 * available: the run wrote movement_analysis.mp4 (or the file list could not
 * be read, in which case GET /jobs/{id}/video itself says what is wrong).
 * absent: the run wrote no processed video.
 */
export type AnnotatedVideo = { state: 'available'; jobId: string } | { state: 'absent' }

type Source = 'annotated' | 'original'

const SOURCES: ReadonlyArray<{ value: Source; label: string }> = [
  { value: 'annotated', label: 'Annotated video' },
  { value: 'original', label: 'Original video' },
]

interface ReplayPanelProps {
  replay: ReplayVideo
  annotated: AnnotatedVideo
  /** The selected event's start: a newly loaded video opens there. */
  startAt: number | null
  /** Receives the <video> element when it appears, and null when it goes. */
  onVideoElement: (video: HTMLVideoElement | null) => void
}

/**
 * Plays the analysed fight beside its events, from one of two sources:
 *
 * - the annotated video, with the pipeline's overlays. The backend saves it as
 *   mp4v, which browsers cannot decode, so this plays the H.264 copy that
 *   GET /jobs/{id}/video makes from it, frame for frame.
 * - the original footage, from the user's own copy: the file uploaded from
 *   this page, or one chosen again, which must have exactly the upload's size.
 *
 * Both have the frames and timing of the analysed video, so an event's start
 * time is the same position in either.
 */
export function ReplayPanel({ replay, annotated, startAt, onVideoElement }: ReplayPanelProps) {
  const [choice, setChoice] = useState<Source>('annotated')
  const source: Source = annotated.state === 'available' ? choice : 'original'

  // Read when a video has loaded its length, so switching source keeps the
  // selected event in view. A ref, so a new selection does not reload the video.
  const startAtRef = useRef(startAt)
  useEffect(() => {
    startAtRef.current = startAt
  }, [startAt])
  const openAtEvent = useCallback((video: HTMLVideoElement) => {
    const start = startAtRef.current
    if (start !== null && video.currentTime === 0) seekTo(video, start)
  }, [])

  return (
    <section aria-label="Replay" className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <h2 className="text-sm leading-[18px] font-semibold">Replay</h2>
          <p className="mt-0.5 text-[10px] leading-[13px] text-muted">
            {source === 'annotated'
              ? 'The analysed footage with the pipeline’s overlays.'
              : 'The original footage, without the pipeline’s overlays.'}
          </p>
        </div>
        {annotated.state === 'available' && (
          <Segmented label="Replay source" options={SOURCES} value={source} onChange={setChoice} />
        )}
      </header>

      {annotated.state === 'available' && source === 'annotated' ? (
        <AnnotatedReplay
          key={annotated.jobId}
          jobId={annotated.jobId}
          onVideoElement={onVideoElement}
          onLoaded={openAtEvent}
        />
      ) : (
        <OriginalReplay
          replay={replay}
          noAnnotated={annotated.state === 'absent'}
          onVideoElement={onVideoElement}
          onLoaded={openAtEvent}
        />
      )}
    </section>
  )
}

type AnnotatedState =
  /** Waiting for the video's length; the first request also waits for the conversion. */
  | { kind: 'loading' }
  | { kind: 'ready' }
  /** The <video> failed; asking the backend why. */
  | { kind: 'checking' }
  | { kind: 'failed'; message: string; retry: boolean }

function AnnotatedReplay({
  jobId,
  onVideoElement,
  onLoaded,
}: {
  jobId: string
  onVideoElement: (video: HTMLVideoElement | null) => void
  onLoaded: (video: HTMLVideoElement) => void
}) {
  const [state, setState] = useState<AnnotatedState>({ kind: 'loading' })
  // Changing it gives a new <video>, which asks the backend again.
  const [attempt, setAttempt] = useState(0)

  const onError = () => {
    setState({ kind: 'checking' })
    checkProcessedVideo(jobId).then(
      () =>
        setState({
          kind: 'failed',
          retry: false,
          message:
            'This browser could not play the annotated video. Download movement_analysis.mp4 for a desktop player, or replay the original video.',
        }),
      (error: unknown) =>
        setState({
          kind: 'failed',
          retry: true,
          message: `The backend could not prepare the annotated video: ${messageOf(error)}`,
        }),
    )
  }

  const retry = () => {
    setState({ kind: 'loading' })
    setAttempt((count) => count + 1)
  }

  return (
    <>
      <div className="px-4">
        <video
          key={attempt}
          ref={onVideoElement}
          src={processedVideoUrl(jobId)}
          aria-label="Annotated replay of movement_analysis.mp4"
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            setState({ kind: 'ready' })
            onLoaded(event.currentTarget)
          }}
          onError={onError}
          className="aspect-video w-full rounded-md bg-black object-contain"
        />
      </div>
      <div className="space-y-2.5 px-4 pt-3 pb-3.5 text-[11px] leading-[14px]">
        {state.kind === 'loading' && (
          <p role="status" className="text-warn">
            Preparing the annotated video. The first time it is opened, the backend converts it for
            the browser, which can take a few seconds.
          </p>
        )}
        {state.kind === 'checking' && (
          <p role="status" className="text-warn">
            The annotated video did not load. Asking the backend why.
          </p>
        )}
        {state.kind === 'failed' && (
          <p role="alert" className="text-warn">
            {state.message}
          </p>
        )}
        <p className="text-fg-soft">
          An H.264 copy of movement_analysis.mp4, made by the backend for the browser frame for
          frame, so the event times line up.
        </p>
        {state.kind === 'failed' && state.retry && (
          <button
            type="button"
            onClick={retry}
            className="h-7 rounded-md bg-control px-3 text-xs font-semibold text-fg transition-colors hover:bg-control-hover"
          >
            Try again
          </button>
        )}
      </div>
    </>
  )
}

function OriginalReplay({
  replay,
  noAnnotated,
  onVideoElement,
  onLoaded,
}: {
  replay: ReplayVideo
  /** The run wrote no processed video, so this is the only replay. */
  noAnnotated: boolean
  onVideoElement: (video: HTMLVideoElement | null) => void
  onLoaded: (video: HTMLVideoElement) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const { source, refusal, upload, canChoose } = replay

  const onChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) replay.choose(file)
    // Clear the input so choosing the same file again still fires a change.
    event.target.value = ''
  }

  return (
    <>
      {source ? (
        // A new source gets a new element, so an error from the last file is forgotten.
        <FilePlayer key={source.key} source={source} onVideoElement={onVideoElement} onLoaded={onLoaded} />
      ) : (
        <div className="mx-4 grid aspect-video place-items-center rounded-md border border-dashed border-line-strong bg-ink/60 text-muted">
          <span className="flex flex-col items-center gap-2 text-[11px] leading-[14px]">
            <Film size={20} aria-hidden />
            No video loaded
          </span>
        </div>
      )}

      <div className="space-y-2.5 px-4 pt-3 pb-3.5 text-[11px] leading-[14px]">
        {noAnnotated && (
          <p className="text-fg-soft">
            This job did not produce movement_analysis.mp4, so there is no annotated video to
            replay.
          </p>
        )}
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
    </>
  )
}

function FilePlayer({
  source,
  onVideoElement,
  onLoaded,
}: {
  source: ReplaySource
  onVideoElement: (video: HTMLVideoElement | null) => void
  onLoaded: (video: HTMLVideoElement) => void
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
    return () => {
      // Detach first: a <video> still pointing at a released URL keeps
      // requesting it, and the browser logs each failure.
      element.removeAttribute('src')
      element.load()
      URL.revokeObjectURL(url)
    }
  }, [source.file])

  return (
    <div className="px-4">
      <video
        ref={attach}
        aria-label={`Replay of ${source.file.name}`}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => onLoaded(event.currentTarget)}
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
