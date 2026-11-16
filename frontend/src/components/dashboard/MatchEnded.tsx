import type { JobState } from '../../hooks/useAnalysisJob'
import { ARTIFACT_PATHS } from '../../services/artifactPaths'
import { cx } from '../../utils/cx'
import { compareScores } from '../../utils/scoring'
import { ComparisonTable } from '../analytics/ComparisonTable'
import {
  ArtifactsPanel,
  DirectionPanel,
  MovementPanel,
  ProcessedVideoPanel,
} from '../analytics/InsightPanels'
import { JobFiles } from '../analytics/JobFiles'
import { ReportPanel } from '../analytics/ReportPanel'
import { ResultSummary } from '../analytics/ResultSummary'
import { ScoreCard } from '../analytics/ScoreCard'
import { ScorecardCheck } from '../analytics/ScorecardCheck'
import { ScoringRules } from '../analytics/ScoringRules'
import { EventTimeline } from '../timeline/EventTimeline'
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
  timelineMessage,
  unscoredCounts,
  type MatchNotice,
  type NoticeTone,
} from './matchEndedState'

interface MatchEndedProps {
  job: JobState
  /** Loads the results of the completed job again. */
  onRetry: () => void
}

/**
 * State two of the dashboard: the final fight analysis.
 *
 * The grid follows the Figma "Match Ended" variant: score cards and result on
 * the first row, the scoring rules, then the comparison beside four smaller
 * panels, then the event timeline. A completed job adds its scorecard report
 * and the list of every file it wrote. Every value comes from the backend;
 * until it has sent them, each panel says what it is waiting for.
 */
export function MatchEnded({ job, onRetry }: MatchEndedProps) {
  const phase = matchPhase(job)
  const heading = matchHeading(phase, job)
  const scorecard = scorecardOf(phase)
  const blue = activityScore(phase, 'blue')
  const red = activityScore(phase, 'red')

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
          <MovementPanel report={lookupFile(phase, ARTIFACT_PATHS.movementReport)} />
          <DirectionPanel
            report={lookupFile(phase, ARTIFACT_PATHS.directionReport)}
            data={lookupFile(phase, ARTIFACT_PATHS.directionData)}
          />
          <ProcessedVideoPanel video={lookupFile(phase, ARTIFACT_PATHS.processedVideo)} />
          <ArtifactsPanel
            finalEvents={lookupFile(phase, ARTIFACT_PATHS.finalEvents)}
            scorecardReport={lookupFile(phase, ARTIFACT_PATHS.scorecardReport)}
            progress={progressSummary(job)}
            listProblem={fileListProblem(phase)}
            fileCount={fileCount(phase)}
          />
        </div>
      </div>

      <div className="mt-5">
        <EventTimeline message={timelineMessage(phase)} />
      </div>

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
