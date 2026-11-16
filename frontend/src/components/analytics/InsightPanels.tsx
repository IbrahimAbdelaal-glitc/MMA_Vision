import { Film } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatFileSize } from '../../utils/format'
import type { FileLookup } from '../dashboard/matchEndedState'
import { AnalyticsPanel } from './AnalyticsPanel'
import { FileLink } from './FileLink'

/*
 * The four smaller panels of the Match Ended state. Each one shows only what
 * the backend wrote for the job. The dashboard does not chart movement or
 * direction data yet, so those panels link to the backend's own reports
 * instead of showing figures.
 */

const NOTE = 'text-[11px] leading-[14px] text-fg-soft'
const FINE_PRINT = 'mt-0.5 text-[10px] leading-[13px] text-muted'

/** A file's status in a few words: a download link, "Not produced", or why it is unknown. */
function FileValue({ lookup }: { lookup: FileLookup }) {
  if (lookup.state === 'found') return <FileLink file={lookup.file} />
  return <span className="text-muted">{lookup.state === 'absent' ? 'Not produced' : lookup.label}</span>
}

function FileRow({ label, lookup }: { label: string; lookup: FileLookup }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-fg-soft">{label}</dt>
      <dd className="min-w-0 text-right">
        <FileValue lookup={lookup} />
      </dd>
    </div>
  )
}

function NoDataYet({ children, fine }: { children: ReactNode; fine: string }) {
  return (
    <>
      <p className={`mt-2.5 ${NOTE}`}>{children}</p>
      <p className={FINE_PRINT}>{fine}</p>
    </>
  )
}

export function MovementPanel({ report }: { report: FileLookup }) {
  if (report.state === 'unknown') {
    return (
      <AnalyticsPanel title="Movement analysis">
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="caps-heading text-corner-blue">Blue</dt>
            <dd className="mt-1 text-lg leading-6 font-semibold text-muted">—</dd>
          </div>
          <div>
            <dt className="caps-heading text-corner-red">Red</dt>
            <dd className="mt-1 text-lg leading-6 font-semibold text-muted">—</dd>
          </div>
        </dl>
        <NoDataYet fine="Backend movement output only; no inferred metrics.">
          No movement data retrieved.
        </NoDataYet>
      </AnalyticsPanel>
    )
  }

  return (
    <AnalyticsPanel title="Movement analysis">
      <dl className="mt-3 text-[11px] leading-[14px]">
        <FileRow label="Movement report" lookup={report} />
      </dl>
      <NoDataYet fine="Speed, distance and wrist activity are not charted in the dashboard yet.">
        {report.state === 'found'
          ? 'The backend wrote a movement report for this job.'
          : 'This job did not write a movement report.'}
      </NoDataYet>
    </AnalyticsPanel>
  )
}

export function DirectionPanel({ report, data }: { report: FileLookup; data: FileLookup }) {
  if (report.state === 'unknown' && data.state === 'unknown') {
    return (
      <AnalyticsPanel title="Opponent direction">
        <p className="mt-3 text-lg leading-6 font-semibold text-muted">—</p>
        <p className="caps-heading mt-1 text-muted">Unavailable</p>
        <NoDataYet fine="No directional breakdown is estimated.">
          No direction analysis retrieved.
        </NoDataYet>
      </AnalyticsPanel>
    )
  }

  return (
    <AnalyticsPanel title="Opponent direction">
      <dl className="mt-3 space-y-2 text-[11px] leading-[14px]">
        <FileRow label="Direction report" lookup={report} />
        <FileRow label="Direction data" lookup={data} />
      </dl>
      <p className={`mt-2.5 ${FINE_PRINT}`}>
        Whether each movement points at the opponent. Not charted in the dashboard yet.
      </p>
    </AnalyticsPanel>
  )
}

export function ProcessedVideoPanel({ video }: { video: FileLookup }) {
  return (
    <AnalyticsPanel title="Processed video">
      <div className="mt-3 flex items-start gap-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-md border border-line bg-panel-raised text-muted">
          <Film size={18} aria-hidden />
        </span>
        <div className="min-w-0 text-[11px] leading-[14px]">
          {video.state === 'found' ? (
            <>
              <FileLink file={video.file} />
              <p className={FINE_PRINT}>
                {video.file.sizeBytes !== null && `${formatFileSize(video.file.sizeBytes)} · `}
                Saved with the mp4v codec, which most browsers cannot play. Open it in a desktop
                video player.
              </p>
            </>
          ) : video.state === 'absent' ? (
            <>
              <p className="text-fg-soft">Not produced</p>
              <p className={FINE_PRINT}>This job did not write videos/movement_analysis.mp4.</p>
            </>
          ) : (
            <>
              <p className={NOTE}>Processed video unavailable</p>
              <p className={FINE_PRINT}>
                {video.label === 'Unavailable'
                  ? 'Load a completed job to view its video.'
                  : 'The annotated video is listed once the job has finished.'}
              </p>
            </>
          )}
        </div>
      </div>
    </AnalyticsPanel>
  )
}

interface ArtifactsPanelProps {
  finalEvents: FileLookup
  scorecardReport: FileLookup
  progress: string
  /** Why the list of job files could not be loaded. */
  listProblem: string | null
  fileCount: number | null
}

export function ArtifactsPanel({
  finalEvents,
  scorecardReport,
  progress,
  listProblem,
  fileCount,
}: ArtifactsPanelProps) {
  return (
    <AnalyticsPanel title="Reports & artifacts">
      <dl className="mt-3 space-y-2 text-[11px] leading-[14px]">
        <FileRow label="Strike-event CSV" lookup={finalEvents} />
        <FileRow label="Scorecard report" lookup={scorecardReport} />
        <div className="flex justify-between gap-3 border-t border-line pt-2">
          <dt className="text-fg-soft">Job progress</dt>
          <dd className="text-right text-muted">{progress}</dd>
        </div>
      </dl>
      {listProblem && (
        <p className="mt-2.5 text-[10px] leading-[13px] text-warn">
          File list unavailable: {listProblem}
        </p>
      )}
      {fileCount !== null && (
        <a
          href="#job-files"
          className="mt-2.5 inline-block text-[11px] leading-[14px] font-medium text-corner-blue underline-offset-2 hover:underline"
        >
          All {fileCount} job files
        </a>
      )}
    </AnalyticsPanel>
  )
}
