import type { MouseEvent } from 'react'
import type { CandidateEvent } from '../../types/api'
import { cx } from '../../utils/cx'
import { formatClock, formatMeasure } from '../../utils/format'
import { pointsFor } from '../../utils/scoring'
import { detectionLabel } from '../../utils/detectionLabel'
import { SERIES_COLORS } from '../charts/series'
import { Swatch } from '../charts/Swatch'
import { Segmented } from '../common/Segmented'
import { EventStrip } from './EventStrip'
import { CORNER_NAMES, eventRowName, movementLabel } from './eventText'

export type EventFilter = 'scored' | 'all'

const COLUMNS: ReadonlyArray<{ label: string; numeric: boolean }> = [
  { label: 'Timestamp', numeric: false },
  { label: 'Fighter', numeric: false },
  { label: 'Estimated type', numeric: false },
  { label: 'Classification', numeric: false },
  { label: 'Points', numeric: true },
  { label: 'Keypoint confidence', numeric: true },
  { label: 'Kinematic score (heuristic)', numeric: true },
]

export interface TimelineEvents {
  /** The events listed under the current filter, in the order they peaked. */
  visible: readonly CandidateEvent[]
  scoredCount: number
  allCount: number
  /** Rows of the file that were left out because their fighter or class was not recognised. */
  unrecognisedRows: number
}

interface EventTimelineProps {
  /** null until the job's events have been read; `message` then says why. */
  events: TimelineEvents | null
  message: string | null
  filter: EventFilter
  onFilterChange: (filter: EventFilter) => void
  selectedId: string | null
  onSelect: (event: CandidateEvent) => void
  /** The end of the strip's time axis, or null when it is not known. */
  timelineEnd: number | null
  video: HTMLVideoElement | null
  className?: string
}

/**
 * The finished analysis event by event, from classified_strike_candidates.csv:
 * a strip with every listed event on the video's time axis, then one table
 * row per event. Selecting an event (in either) shows its measurements and
 * jumps the replay to it.
 */
export function EventTimeline({
  events,
  message,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  timelineEnd,
  video,
  className,
}: EventTimelineProps) {
  return (
    <section
      aria-label="Event timeline and detailed statistics"
      className={cx('overflow-hidden rounded-lg border border-line bg-panel', className)}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 pt-4">
        <div className="min-w-0 basis-72">
          <h2 className="text-[17px] leading-[21px] font-semibold">
            Event timeline &amp; detailed statistics
          </h2>
          <p className="mt-1 text-[11px] leading-[14px] text-muted">
            Strike-like movement candidates from classified_strike_candidates.csv, in the order they
            peaked. Estimated from pose keypoints: none is a confirmed landed strike.
          </p>
        </div>
        {events && (
          <Segmented
            label="Events shown"
            value={filter}
            onChange={onFilterChange}
            options={[
              { value: 'scored', label: `Scored events (${events.scoredCount})` },
              { value: 'all', label: `All candidates (${events.allCount})` },
            ]}
          />
        )}
      </header>

      {events && timelineEnd !== null && events.visible.length > 0 && (
        <div className="px-5 pt-4">
          <EventStrip
            events={events.visible}
            end={timelineEnd}
            selectedId={selectedId}
            onSelect={onSelect}
            video={video}
          />
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-y border-line bg-panel-raised text-[9px] leading-[11px] tracking-[0.6px] text-muted uppercase">
              {COLUMNS.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={cx('px-5 py-2 font-semibold whitespace-nowrap', column.numeric && 'text-right')}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events && events.visible.length > 0 ? (
              events.visible.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={event.id === selectedId}
                  onSelect={onSelect}
                />
              ))
            ) : (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-3 text-[11px] leading-[14px] text-muted">
                  {events ? emptyMessage(filter) : message}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {events && (
        <footer className="space-y-1 border-t border-line px-5 py-3 text-[10px] leading-[13px] text-muted">
          <p>
            Points follow the experimental scoring rules: Significant 3, Strong 2, Review and Low 0.
            The kinematic score is the pipeline’s heuristic ranking from 0 to 100, not a
            probability; keypoint confidence is the pose model’s mean confidence for the limb.
          </p>
          {events.unrecognisedRows > 0 && (
            <p className="text-warn">
              {events.unrecognisedRows === 1 ? '1 row' : `${events.unrecognisedRows} rows`} of
              classified_strike_candidates.csv had an unrecognised fighter or class and{' '}
              {events.unrecognisedRows === 1 ? 'is' : 'are'} not listed.
            </p>
          )}
        </footer>
      )}
    </section>
  )
}

function emptyMessage(filter: EventFilter): string {
  return filter === 'scored'
    ? 'No Strong or Significant events in this job. Show all candidates to list the Review and Low ones.'
    : 'classified_strike_candidates.csv lists no events for this job.'
}

interface EventRowProps {
  event: CandidateEvent
  selected: boolean
  onSelect: (event: CandidateEvent) => void
}

function EventRow({ event, selected, onSelect }: EventRowProps) {
  // The whole row is a pointer target; the timestamp button is the keyboard
  // one. A click on the button reaches the row too, so the row ignores it.
  const onRowClick = (click: MouseEvent<HTMLTableRowElement>) => {
    if (!(click.target as Element).closest('button')) onSelect(event)
  }
  const scored = pointsFor(event.detectionClass) > 0

  return (
    <tr
      onClick={onRowClick}
      className={cx(
        'cursor-pointer border-t border-line/70 text-xs leading-4 transition-colors',
        selected ? 'bg-panel-raised' : 'hover:bg-panel-soft',
        scored ? 'text-fg' : 'text-fg-soft',
      )}
    >
      <th scope="row" className="relative px-5 py-[7px] font-semibold whitespace-nowrap tabular-nums">
        {selected && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-0.5"
            style={{ backgroundColor: SERIES_COLORS[event.corner] }}
          />
        )}
        <button
          type="button"
          aria-label={eventRowName(event)}
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect(event)}
          className="rounded-sm underline-offset-2 hover:underline"
        >
          {formatClock(event.peakTime)}
        </button>
      </th>
      <td className="px-5 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <Swatch color={SERIES_COLORS[event.corner]} />
          {CORNER_NAMES[event.corner]}
        </span>
      </td>
      <td className="px-5 whitespace-nowrap">{movementLabel(event)}</td>
      <td className="px-5 whitespace-nowrap">{detectionLabel(event.detectionClass)}</td>
      <td className="px-5 text-right tabular-nums">{pointsFor(event.detectionClass)}</td>
      <td className="px-5 text-right tabular-nums">{formatMeasure(event.keypointConfidence, 2)}</td>
      <td className="px-5 text-right tabular-nums">{formatMeasure(event.kinematicScore, 2)}</td>
    </tr>
  )
}
