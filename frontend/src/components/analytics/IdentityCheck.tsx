import { ArrowLeftRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, messageOf } from '../../services/http'
import { getIdentityCheck } from '../../services/liveApi'
import type { IdentityCheck as Check } from '../../types/live'
import { formatClock, formatMeasure } from '../../utils/format'

type Load = { state: 'loading' } | { state: 'absent' } | { state: 'loaded'; check: Check } | { state: 'error'; message: string }

const REASON_LABELS: Record<keyof Check['notComparedSeconds'], string> = {
  ambiguous: 'too close to tell',
  live_uncertain: 'live identity uncertain',
  live_lost: 'live fighter not tracked',
  offline_missing: 'fighter missing offline',
}

/**
 * Design 12: whether the live session's Blue/Red labels matched the final
 * (offline) ones. Shown only for a job that came from a live session.
 * The final scorecard is never relabelled; this only flags where the
 * provisional live labels differed.
 */
export function IdentityCheck({ jobId, fetchCheck = getIdentityCheck }: { jobId: string; fetchCheck?: typeof getIdentityCheck }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchCheck(jobId, controller.signal).then(
      (check) => setLoad({ state: 'loaded', check }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        // A backend without the endpoint has no live records to compare.
        if (error instanceof ApiError && error.status === 404) setLoad({ state: 'absent' })
        else setLoad({ state: 'error', message: messageOf(error) })
      },
    )
    return () => controller.abort()
  }, [jobId, fetchCheck])

  if (load.state === 'loading' || load.state === 'absent') return null
  if (load.state === 'loaded' && load.check.state === 'unavailable') return null

  let body
  if (load.state === 'error') {
    body = <p className="mt-1.5 text-[11px] leading-[14px] text-muted">The identity check could not be loaded: {load.message}</p>
  } else {
    const c = load.check
    const notCompared = Object.entries(c.notComparedSeconds).filter(([, s]) => s > 0)
    const summary =
      c.state === 'agree'
        ? 'Live Blue and Red matched the final labels in every compared frame.'
        : c.state === 'disagree'
          ? 'In these intervals, live Blue was the final Red and live Red the final Blue.'
          : 'No frame could be compared, so agreement is not known.'
    body = (
      <>
        <p className="mt-1.5 text-[11px] leading-[14px] text-fg-soft">{summary}</p>
        <p className="mt-1 text-[10px] leading-[13px] text-muted">
          Compared {formatMeasure(c.comparedSeconds, 1)} s of {formatMeasure(c.liveSpanSeconds, 1)} s analysed live
          {notCompared.length > 0 &&
            `; not compared: ${notCompared
              .map(([reason, seconds]) => `${formatMeasure(seconds, 1)} s ${REASON_LABELS[reason as keyof Check['notComparedSeconds']]}`)
              .join(', ')}`}
          . Time not compared never counts as agreement.
        </p>
        {c.intervals.length > 0 && (
          <ul aria-label="Disagreement intervals" className="mt-2 space-y-1 text-[11px] leading-[14px]">
            {c.intervals.map((interval) => (
              <li key={interval.start} className="tabular-nums">
                {formatClock(interval.start)}–{formatClock(interval.end)}: Live (provisional) Blue = Final scorecard Red
                {interval.identityLogEntry && <span className="text-muted"> · {interval.identityLogEntry}</span>}
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  const tone = load.state === 'loaded' && load.check.state === 'disagree' ? 'border-warn/30 bg-warn-surface' : 'border-line-strong bg-hud'
  return (
    <section aria-label="Identity check" className={`flex gap-3 rounded-lg border px-4 py-3 ${tone}`}>
      <ArrowLeftRight size={14} aria-hidden className="mt-px shrink-0 text-fg-soft" />
      <div className="min-w-0">
        <h2 className="caps-heading text-fg">Identity check: Live (provisional) vs. Final scorecard</h2>
        {body}
      </div>
    </section>
  )
}
