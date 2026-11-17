import { TriangleAlert } from 'lucide-react'

/**
 * Problems found while reading the backend's scorecard: a missing fighter, a
 * value that is not a whole number, or a score that does not follow the
 * scoring rules shown below it. The values stay as the backend wrote them.
 */
export function ScorecardCheck({ issues }: { issues: readonly string[] }) {
  return (
    <section
      aria-label="Scorecard check"
      className="flex gap-3 rounded-lg border border-warn/30 bg-warn-surface px-4 py-3"
    >
      <TriangleAlert size={14} aria-hidden className="mt-px shrink-0 text-warn" />
      <div className="min-w-0">
        <h2 className="caps-heading text-warn">Scorecard check</h2>
        <ul className="mt-1.5 space-y-0.5 text-[11px] leading-[14px] text-fg-soft">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10px] leading-[13px] text-muted">
          The values above are shown as the backend wrote them.
        </p>
      </div>
    </section>
  )
}
