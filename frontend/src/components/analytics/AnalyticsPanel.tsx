import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'

interface AnalyticsPanelProps {
  title: string
  children: ReactNode
  className?: string
}

/** The shared frame for the smaller panels of the Match Ended state. */
export function AnalyticsPanel({ title, children, className }: AnalyticsPanelProps) {
  return (
    <section
      aria-label={title}
      className={cx('rounded-lg border border-line bg-panel px-5 py-4', className)}
    >
      <h2 className="text-sm leading-[18px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}
