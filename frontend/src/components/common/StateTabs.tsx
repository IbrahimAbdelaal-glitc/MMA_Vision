import type { KeyboardEvent } from 'react'
import type { DashboardView } from '../../types/dashboard'
import { cx } from '../../utils/cx'
import { panelId, tabId } from './tabIds'

const TABS: ReadonlyArray<{ view: DashboardView; label: string }> = [
  { view: 'live', label: 'Live Monitoring' },
  { view: 'ended', label: 'Match Ended' },
]

interface StateTabsProps {
  view: DashboardView
  onChange: (view: DashboardView) => void
  className?: string
}

/** The two states of the single dashboard. */
export function StateTabs({ view, onChange, className }: StateTabsProps) {
  // Standard tab keyboard behaviour: the arrow keys move between tabs.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next: DashboardView = view === 'live' ? 'ended' : 'live'
    onChange(next)
    document.getElementById(tabId(next))?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Dashboard state"
      onKeyDown={onKeyDown}
      className={cx('flex gap-2', className)}
    >
      {TABS.map((tab) => {
        const selected = tab.view === view
        return (
          <button
            key={tab.view}
            type="button"
            role="tab"
            id={tabId(tab.view)}
            aria-selected={selected}
            aria-controls={selected ? panelId(tab.view) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.view)}
            className={cx(
              'h-9 flex-1 rounded-md px-3.5 text-left text-[13px] font-semibold transition-colors md:w-[150px] md:flex-none xl:w-[158px]',
              selected
                ? 'bg-[#252527] text-fg ring-1 ring-corner-blue-line ring-inset'
                : 'bg-panel-raised text-muted hover:text-fg',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
