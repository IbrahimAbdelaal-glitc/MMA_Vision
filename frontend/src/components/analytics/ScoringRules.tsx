import { SCORING_RULES } from '../../utils/scoring'
import { detectionLabel } from '../../utils/detectionLabel'

/** The project's exact experimental scoring rules. */
export function ScoringRules() {
  return (
    <section
      aria-label="Experimental scoring rules"
      className="flex flex-col gap-3 rounded-lg bg-panel-soft px-[18px] py-3.5 md:flex-row md:items-center md:justify-between"
    >
      <div>
        <p className="caps-heading text-fg">Experimental scoring</p>
        <p className="mt-1.5 text-[11px] leading-[13px] text-muted">
          Score = (Significant × 3) + (Strong × 2)
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 md:flex md:gap-0 md:divide-x md:divide-line">
        {SCORING_RULES.map((rule) => (
          <li key={rule.detectionClass} className="md:px-6 md:last:pr-1">
            <p className="caps-heading text-muted">{detectionLabel(rule.detectionClass)}</p>
            <p className="mt-1.5 text-[13px] leading-4 font-semibold">{rule.points} points</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
