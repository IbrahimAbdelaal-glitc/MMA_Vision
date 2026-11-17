import type { JobResults, Part } from '../../types/api'

/**
 * experimental_scorecard_report.txt exactly as the backend wrote it. The
 * report lines its columns up with spaces, so it is set in a monospace face.
 */
export function ReportPanel({ results }: { results: Part<JobResults> }) {
  const report = results.state === 'ready' ? results.data.report : null
  const reason =
    results.state === 'ready' ? 'The backend sent no report for this job.' : results.message

  return (
    <section
      aria-label="Scorecard report"
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel"
    >
      <header className="px-5 pt-4 pb-3">
        <h2 className="text-[17px] leading-[21px] font-semibold">Scorecard report</h2>
        <p className="mt-1 text-[11px] leading-[14px] text-muted">
          experimental_scorecard_report.txt, as the backend wrote it
        </p>
      </header>
      {report ? (
        <pre className="flex-1 overflow-x-auto border-t border-line bg-ink/50 px-5 py-4 font-mono text-[11px] leading-4 text-fg-soft">
          {report}
        </pre>
      ) : (
        <p className="border-t border-line px-5 py-3 text-[11px] leading-[14px] text-muted">
          {reason}
        </p>
      )}
    </section>
  )
}
