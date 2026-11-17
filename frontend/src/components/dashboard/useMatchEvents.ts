import { useMemo } from 'react'
import {
  directionByClass,
  linkDirection,
  scoredEvents,
  sortByPeak,
  type ClassDirection,
  type LinkedDirectionRow,
} from '../../services/events'
import type { AnalysisData, CandidateEvent, DirectionRow } from '../../types/api'

export interface MatchEvents {
  /** Every candidate event, in the order they peaked. */
  ordered: CandidateEvent[]
  /** The Strong and Very Strong events: the ones that score points. */
  scored: CandidateEvent[]
  /** Each direction row joined to its event; null when the direction data is not available. */
  linked: LinkedDirectionRow[] | null
  /** The class averages of opponent_direction_report.txt, computed from the rows. */
  byClass: ClassDirection[] | null
  /** The direction row of each event, by event id. */
  directionOf: ReadonlyMap<string, DirectionRow>
}

/**
 * The events of a loaded job and their direction measurements, worked out
 * once per load rather than on every render.
 */
export function useMatchEvents(data: AnalysisData | null): MatchEvents {
  const events = data?.events.state === 'ready' ? data.events.data.events : null
  const rows = data?.direction.state === 'ready' ? data.direction.data.rows : null

  const ordered = useMemo(() => (events ? sortByPeak(events) : []), [events])
  const scored = useMemo(() => scoredEvents(ordered), [ordered])
  // Joined by fighter, limb, movement type, class and peak time.
  const linked = useMemo(() => (rows ? linkDirection(events ?? [], rows) : null), [events, rows])
  const byClass = useMemo(() => (rows ? directionByClass(rows) : null), [rows])
  const directionOf = useMemo(
    () => new Map((linked ?? []).flatMap((row) => (row.eventId ? [[row.eventId, row] as const] : []))),
    [linked],
  )

  return { ordered, scored, linked, byClass, directionOf }
}
