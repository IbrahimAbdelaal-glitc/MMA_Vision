import type { CandidateEvent } from '../../types/api'
import type { Corner, DetectionClass } from '../../types/dashboard'
import { formatClock } from '../../utils/format'
import { pointsFor } from '../../utils/scoring'
import { detectionLabel } from '../../utils/detectionLabel'

/*
 * The words used for one strike-like movement candidate, wherever it is
 * shown: the event table, the timeline strip, the direction chart and the
 * selected-event card all describe an event the same way.
 */

export const CORNER_NAMES: Record<Corner, string> = { blue: 'Blue', red: 'Red' }

/** "Punch-like · right": the pipeline's estimated movement type and the limb's side. */
export function movementLabel(event: Pick<CandidateEvent, 'eventType' | 'side'>): string {
  const type = event.eventType
    ? event.eventType[0].toUpperCase() + event.eventType.slice(1)
    : 'Unknown movement'
  return event.side ? `${type} · ${event.side}` : type
}

/** "3 points", under the experimental scoring rules. */
export function pointsLabel(detectionClass: DetectionClass): string {
  const points = pointsFor(detectionClass)
  return `${points} point${points === 1 ? '' : 's'}`
}

/** What a screen reader hears for an event's row: "00:01.283 Blue punch-like, right, Significant". */
export function eventRowName(event: CandidateEvent): string {
  const side = event.side ? `, ${event.side}` : ''
  return `${formatClock(event.peakTime)} ${CORNER_NAMES[event.corner]} ${event.eventType}${side}, ${detectionLabel(event.detectionClass)}`
}
