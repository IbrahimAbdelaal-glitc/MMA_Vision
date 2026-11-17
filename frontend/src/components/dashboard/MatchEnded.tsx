import { useState } from 'react'
import type { JobState } from '../../hooks/useAnalysisJob'
import type { ReplayVideo } from '../../hooks/useReplayVideo'
import { ARTIFACT_PATHS } from '../../services/artifactPaths'
import { adjacentEvent } from '../../services/events'
import type { CandidateEvent } from '../../types/api'
import { cx } from '../../utils/cx'
import { compareScores } from '../../utils/scoring'
import { seekTo } from '../../utils/seek'
import { ComparisonTable } from '../analytics/ComparisonTable'
import { DirectionChart } from '../analytics/DirectionChart'
import {
  ArtifactsPanel,
  DirectionPanel,
  MovementPanel,
  ProcessedVideoPanel,
} from '../analytics/InsightPanels'
import { JobFiles } from '../analytics/JobFiles'
import { MovementCharts } from '../analytics/MovementCharts'
import { ReportPanel } from '../analytics/ReportPanel'
import { ResultSummary } from '../analytics/ResultSummary'
import { ScoreCard } from '../analytics/ScoreCard'
import { ScorecardCheck } from '../analytics/ScorecardCheck'
import { ScoringRules } from '../analytics/ScoringRules'
import { ReplayPanel, type AnnotatedVideo } from '../replay/ReplayPanel'
import { SelectedEvent, type EventDirection } from '../replay/SelectedEvent'
import { EventTimeline, type EventFilter, type TimelineEvents } from '../timeline/EventTimeline'
import {
  activityScore,
  fileCount,
  fileListProblem,
  lookupFile,
  matchHeading,
  matchNotice,
  matchPhase,
  pendingResultLabel,
  progressSummary,
  scoreCaption,
  scorecardOf,
  timelineEnd,
  timelineMessage,
  unscoredCounts,
  type MatchNotice,
  type NoticeTone,
} from './matchEndedState'
import { useMatchEvents } from './useMatchEvents'

interface MatchEndedProps {
  job: JobState
  /** The original footage the replay can play: a file on this computer. */
  replay: ReplayVideo
  /** Loads the results of the completed job again. */
  onRetry: () => void
}

/**
 * State two of the dashboard: the final fight analysis.
 *
 * The grid follows the Figma "Match Ended" variant: score cards and result on
 * the first row, the scoring rules, then the comparison beside four smaller
 * panels, then the event timeline. A completed job adds the replay and the
 * selected event beside the timeline, the movement and direction charts, its
 * scorecard report and the list of every file it wrote. Every value comes
 * from the backend; until it has sent them, each panel says what it is
 * waiting for.
 *
 * One event can be selected at a time, from the table, the timeline strip or
 * the direction chart. Selecting it shows its measurements and, when a
 * replay is loaded, moves the video to the event's start.
 */
export function MatchEnded({ job, replay, onRetry }: MatchEndedProps) {
  const phase = matchPhase(job)
  const heading = matchHeading(phase, job)
  const scorecard = scorecardOf(phase)
  const blue = activityScore(phase, 'blue')
  const red = activityScore(phase, 'red')
  const data = phase.kind === 'loaded' ? phase.data : null

  const [filter, setFilter] = useState<EventFilter>('scored')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // State, not a ref, so the playheads re-subscribe when the <video> changes.
  const [replayElement, setReplayElement] = useState<HTMLVideoElement | null>(null)

  const eventsPart = data?.events ?? null
  const directionPart = data?.direction ?? null
  const { ordered, scored, linked, byClass, directionOf } = useMatchEvents(data)
  const visible = filter === 'scored' ? scored : ordered

  const selected = ordered.find((event) => event.id === selectedId) ?? null

  const select = (event: CandidateEvent) => {
    setSelectedId(event.id)
    if (replayElement && event.startTime !== null) seekTo(replayElement, event.startTime)
  }

  const selectById = (eventId: string) => {
    const event = ordered.find((candidate) => candidate.id === eventId)
    if (event) select(event)
  }

  // Previous and next follow the list on screen. An event selected elsewhere
  // (say a Low one, from the direction chart, while only scored events are
  // listed) is stepped from by its start time; with no selection, from the
  // replay's position.
  const position = visible.findIndex((event) => event.id === selectedId)
  const canStep =
    position === -1
      ? { previous: visible.length > 0, next: visible.length > 0 }
      : { previous: position > 0, next: position < visible.length - 1 }
  const step = (direction: 1 | -1) => {
    const from = selected?.startTime ?? replayElement?.currentTime ?? null
    const target = adjacentEvent(visible, selectedId, from, direction)
    if (target) select(target)
  }

  const startTime = selected?.startTime ?? null
  const onPlay =
    replayElement && startTime !== null
      ? () => {
          seekTo(replayElement, startTime)
          // play() rejects when the browser refuses or cannot decode the file;
          // the replay's own error message covers that.
          void Promise.resolve(replayElement.play()).catch(() => {})
        }
      : null

  const eventDirection: EventDirection =
    directionPart === null
      ? { state: 'unavailable', message: 'the results have not loaded.' }
      : directionPart.state !== 'ready'
        ? { state: 'unavailable', message: directionPart.message }
        : { state: 'ready', row: selected ? (directionOf.get(selected.id) ?? null) : null }

  const timeline: TimelineEvents | null =
    eventsPart?.state === 'ready'
      ? {
          visible,
          scoredCount: scored.length,
          allCount: ordered.length,
          unrecognisedRows: eventsPart.data.unrecognisedRows,
        }
      : null

  const directionProblem =
    directionPart && directionPart.state !== 'ready' ? directionPart.message : null

  const processedVideo = lookupFile(phase, ARTIFACT_PATHS.processedVideo)
  const annotated: AnnotatedVideo =
    processedVideo.state === 'absent' || !job.jobId
      ? { state: 'absent' }
      : { state: 'available', jobId: job.jobId }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pt-4 pb-5 xl:px-6">
      <Notice notice={matchNotice(phase)} onRetry={onRetry} />

      <header className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[27px] leading-[33px] font-semibold">{heading.title}</h1>
          <p className="mt-1 text-xs leading-[15px] break-words text-muted">{heading.subtitle}</p>
        </div>
        <p className="text-[10px] leading-3 font-semibold text-muted uppercase">
          Job status <span className="mx-1.5">—</span> {heading.statusText}
        </p>
      </header>

      {/* Blue | result | Red on wide screens; the two fighters side by side
          with the result underneath on medium ones; one column on phones. */}
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-[360px_minmax(0,1fr)_360px] xl:gap-6">
        <ScoreCard corner="blue" score={blue} caption={scoreCaption(phase, 'blue')} />
        <ResultSummary
          comparison={compareScores(blue, red)}
          pendingLabel={pendingResultLabel(phase)}
          className="md:order-last md:col-span-2 xl:order-none xl:col-span-1"
        />
        <ScoreCard corner="red" score={red} caption={scoreCaption(phase, 'red')} />
      </div>

      {scorecard && scorecard.issues.length > 0 && (
        <div className="mt-5">
          <ScorecardCheck issues={scorecard.issues} />
        </div>
      )}

      <div className="mt-5">
        <ScoringRules />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2 xl:gap-6">
        <ComparisonTable scorecard={scorecard} unscored={unscoredCounts(phase)} />
        {/* The four panels stretch to the height of the comparison table. */}
        <div className="grid gap-5 sm:grid-cols-2 xl:gap-x-6">
          <MovementPanel
            report={lookupFile(phase, ARTIFACT_PATHS.movementReport)}
            figures={data?.movementReport ?? null}
          />
          <DirectionPanel
            report={lookupFile(phase, ARTIFACT_PATHS.directionReport)}
            data={lookupFile(phase, ARTIFACT_PATHS.directionData)}
            classes={byClass}
            problem={directionProblem}
          />
          <ProcessedVideoPanel video={processedVideo} />
          <ArtifactsPanel
            finalEvents={lookupFile(phase, ARTIFACT_PATHS.finalEvents)}
            scorecardReport={lookupFile(phase, ARTIFACT_PATHS.scorecardReport)}
            progress={progressSummary(job)}
            listProblem={fileListProblem(phase)}
            fileCount={fileCount(phase)}
          />
        </div>
      </div>

      {/* The events beside the replay. On wide, tall screens the replay column
          stays in view while a long list of events scrolls past it. */}
      <div
        className={cx(
          'mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 xl:gap-6',
          data && 'xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start',
        )}
      >
        {data && (
          <div className="space-y-5 xl:col-start-2 xl:row-start-1 xl:tall:sticky xl:tall:top-4">
            <ReplayPanel
              replay={replay}
              annotated={annotated}
              startAt={startTime}
              onVideoElement={setReplayElement}
            />
            <SelectedEvent
              event={selected}
              direction={eventDirection}
              canStep={canStep}
              onStep={step}
              onPlay={onPlay}
            />
          </div>
        )}
        <EventTimeline
          className="xl:col-start-1 xl:row-start-1"
          events={timeline}
          message={timelineMessage(phase)}
          filter={filter}
          onFilterChange={setFilter}
          selectedId={selectedId}
          onSelect={select}
          timelineEnd={data ? timelineEnd(data) : null}
          video={replayElement}
        />
      </div>

      {/* minmax(0, …) at every width: an auto track would first grow to the
          line chart's starting width, and the chart would then measure that
          widened track and keep it, pushing the page wider than a phone. */}
      {data && (
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:gap-6">
          <MovementCharts
            series={data.movement}
            report={data.movementReport}
            artifacts={data.artifacts}
            video={replayElement}
          />
          <DirectionChart
            rows={linked}
            byClass={byClass}
            problem={directionProblem}
            selectedId={selectedId}
            onSelect={selectById}
          />
        </div>
      )}

      {phase.kind === 'loaded' && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:gap-6">
          <ReportPanel results={phase.data.results} />
          <JobFiles artifacts={phase.data.artifacts} />
        </div>
      )}
    </div>
  )
}

const NOTICE_TONES: Record<NoticeTone, { surface: string; label: string }> = {
  warn: { surface: 'bg-warn-surface', label: 'text-warn' },
  error: { surface: 'bg-corner-red-surface', label: 'text-corner-red' },
  info: { surface: 'bg-panel-soft', label: 'text-ended' },
}

/** The line at the top: how far the results can be trusted, and what is missing. */
function Notice({ notice, onRetry }: { notice: MatchNotice; onRetry: () => void }) {
  const tone = NOTICE_TONES[notice.tone]
  return (
    <div
      role="note"
      className={cx(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-3.5 py-3',
        tone.surface,
      )}
    >
      <p className={cx('caps-heading shrink-0', tone.label)}>{notice.label}</p>
      <p className="min-w-0 flex-1 basis-64 text-[11px] leading-[14px] text-fg-soft">
        {notice.message}
      </p>
      {notice.retry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-7 shrink-0 rounded-md bg-control px-3 text-xs font-semibold text-fg transition-colors hover:bg-control-hover"
        >
          Retry loading results
        </button>
      )}
    </div>
  )
}
