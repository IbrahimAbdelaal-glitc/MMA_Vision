import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CandidateEvent, DirectionRow } from '../../types/api'
import { cx } from '../../utils/cx'
import { formatClock, formatGrouped, formatMeasure, formatSigned } from '../../utils/format'
import { detectionLabel } from '../../utils/detectionLabel'
import { CORNER_NAMES, movementLabel, pointsLabel } from '../timeline/eventText'

/**
 * Frames examined per event by src/analyze_opponent_direction.py: eight
 * before the peak to three after it. With fewer than 4 usable frames the
 * stage leaves both direction values empty.
 */
const DIRECTION_FRAMES = 12
const MIN_DIRECTION_FRAMES = 4

/** The direction stage's row for the selected event, or why there is none. */
export type EventDirection =
  | { state: 'ready'; row: DirectionRow | null }
  | { state: 'unavailable'; message: string }

interface SelectedEventProps {
  event: CandidateEvent | null
  direction: EventDirection
  canStep: { previous: boolean; next: boolean }
  onStep: (step: 1 | -1) => void
  /** Plays the replay from the event's start; null when there is no replay. */
  onPlay: (() => void) | null
}

/** Everything the backend measured about one event, beside the replay. */
export function SelectedEvent({ event, direction, canStep, onStep, onPlay }: SelectedEventProps) {
  return (
    <section aria-label="Selected event" className="rounded-lg border border-line bg-panel px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm leading-[18px] font-semibold">Selected event</h2>
        <div className="flex gap-1.5">
          <StepButton label="Previous event" disabled={!canStep.previous} onClick={() => onStep(-1)}>
            <ChevronLeft size={15} aria-hidden />
          </StepButton>
          <StepButton label="Next event" disabled={!canStep.next} onClick={() => onStep(1)}>
            <ChevronRight size={15} aria-hidden />
          </StepButton>
        </div>
      </div>

      {event ? (
        <EventDetails event={event} direction={direction} onPlay={onPlay} />
      ) : (
        <p className="mt-2.5 text-[11px] leading-[14px] text-muted">
          Select an event in the timeline or the direction chart to see its measurements
          {onPlay === null ? '.' : ' and jump the replay to it.'}
        </p>
      )}
    </section>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md bg-control text-fg transition-colors hover:bg-control-hover disabled:bg-control/40 disabled:text-muted"
    >
      {children}
    </button>
  )
}

function EventDetails({
  event,
  direction,
  onPlay,
}: {
  event: CandidateEvent
  direction: EventDirection
  onPlay: (() => void) | null
}) {
  const blue = event.corner === 'blue'
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span
          className={cx(
            'caps-heading rounded px-1.5 py-1',
            blue ? 'bg-corner-blue-surface text-corner-blue' : 'bg-corner-red-surface text-corner-red',
          )}
        >
          {CORNER_NAMES[event.corner]}
        </span>
        <p className="text-sm leading-[18px] font-semibold">{movementLabel(event)}</p>
      </div>
      <p className="mt-2 text-xs leading-4 text-fg-soft">
        {detectionLabel(event.detectionClass)} · {pointsLabel(event.detectionClass)}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-[11px] leading-[14px] text-muted">Peak</span>{' '}
        <span className="text-[22px] leading-7 font-semibold tabular-nums">
          {formatClock(event.peakTime)}
        </span>
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-3">
        <Measure label="Start">{formatClock(event.startTime)}</Measure>
        <Measure label="End">{formatClock(event.endTime)}</Measure>
        <Measure label="Peak speed">
          {event.peakSpeed === null ? '—' : `${formatGrouped(event.peakSpeed, 0)} px/s`}
        </Measure>
        <Measure label="Keypoint confidence">{formatMeasure(event.keypointConfidence, 2)}</Measure>
        <Measure label="Kinematic score (heuristic)" wide>
          {formatMeasure(event.kinematicScore, 2)}
        </Measure>
      </dl>

      <DirectionDetails direction={direction} />

      <p className="mt-3 text-[10px] leading-[13px] text-muted">
        An estimated strike-like movement from pose keypoints, not a confirmed landed strike.
        Contact, impact and damage are not measured.
      </p>

      {onPlay && (
        <button
          type="button"
          onClick={onPlay}
          className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md bg-control px-3 text-xs font-semibold text-fg transition-colors hover:bg-control-hover"
        >
          <Play size={12} aria-hidden />
          Play from event start
        </button>
      )}
    </div>
  )
}

function Measure({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx('min-w-0', wide && 'col-span-2')}>
      <dt className="text-[10px] leading-[13px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-xs leading-4 font-semibold text-fg tabular-nums">{children}</dd>
    </div>
  )
}

function DirectionDetails({ direction }: { direction: EventDirection }) {
  const heading = (
    <h3 className="text-[10px] leading-[13px] font-semibold text-fg-soft">
      Direction relative to the opponent
    </h3>
  )

  if (direction.state === 'unavailable' || direction.row === null) {
    const reason =
      direction.state === 'unavailable'
        ? direction.message
        : 'this event has no matching row in opponent_direction_analysis.csv.'
    return (
      <div className="mt-3 border-t border-line pt-3">
        {heading}
        <p className="mt-1 text-[11px] leading-[14px] text-muted">Direction unavailable: {reason}</p>
      </div>
    )
  }

  const { alignment, approachChange, validSamples } = direction.row
  const tooFewFrames = validSamples !== null && validSamples < MIN_DIRECTION_FRAMES
  return (
    <div className="mt-3 border-t border-line pt-3">
      {heading}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Measure label="Alignment (+1 toward, −1 away)">{formatSigned(alignment, 3)}</Measure>
        <Measure label="Approach change">
          {approachChange === null ? '—' : `${formatSigned(approachChange, 2)} px`}
        </Measure>
        <Measure label="Frames with both fighters measured" wide>
          {validSamples === null ? '—' : `${validSamples} of ${DIRECTION_FRAMES} frames`}
        </Measure>
      </dl>
      {tooFewFrames && (
        <p className="mt-2 text-[10px] leading-[13px] text-warn">
          Not measured: the direction stage needs at least {MIN_DIRECTION_FRAMES} frames in which
          both the limb and the opponent’s torso are visible.
        </p>
      )}
    </div>
  )
}
