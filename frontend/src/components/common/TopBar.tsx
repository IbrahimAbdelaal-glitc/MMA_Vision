import { Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import type { DashboardView } from '../../types/dashboard'
import { BackendStatus } from './BackendStatus'
import type { BackendTone } from './backendTone'
import { StateTabs } from './StateTabs'
import { StatusChip, type StatusTone } from './StatusChip'

interface TopBarProps {
  view: DashboardView
  onViewChange: (view: DashboardView) => void
  status: { tone: StatusTone; label: string }
  /** Middle readout: the video clock in the live state, the job in the ended state. */
  readout: ReactNode
  backend: { label: string; detail: string; tone: BackendTone }
  onSelectVideo: () => void
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-md bg-brand text-[17px] leading-none font-bold text-white"
      >
        M
      </span>
      <div className="leading-none">
        <p className="text-base leading-5 font-bold tracking-wide">MMA VISION</p>
        <p className="mt-0.5 text-[8px] font-semibold tracking-[0.8px] text-muted uppercase">
          Fight intelligence
        </p>
      </div>
    </div>
  )
}

/**
 * The bar across the top of the dashboard.
 *
 * On wide screens everything sits on one 72 px row, as in the Figma. Tablets
 * get two rows (brand, tabs and video button, then status and clock) and
 * phones three (the tabs take a row of their own). `xl:contents` dissolves the
 * wrapper of the status row so its children can join the single wide row.
 */
export function TopBar({
  view,
  onViewChange,
  status,
  readout,
  backend,
  onSelectVideo,
}: TopBarProps) {
  return (
    <header className="relative z-20 border-b border-line bg-bar">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-2.5 xl:h-[72px] xl:flex-nowrap xl:gap-x-5 xl:px-6 xl:py-0">
        <div className="order-1">
          <Brand />
        </div>

        <button
          type="button"
          onClick={onSelectVideo}
          className="order-2 ml-auto flex h-9 items-center gap-2 rounded-md bg-[#252527] px-3.5 text-[13px] font-semibold text-fg transition-colors hover:bg-control-hover md:order-3 xl:order-4"
        >
          <Upload size={14} aria-hidden />
          Select MP4
        </button>

        <StateTabs
          view={view}
          onChange={onViewChange}
          className="order-3 w-full md:order-2 md:ml-6 md:w-auto xl:ml-8"
        />

        <div className="order-4 flex w-full items-center gap-4 xl:contents">
          <div className="flex items-center gap-4 xl:order-3 xl:ml-3">
            <StatusChip tone={status.tone} label={status.label} />
            {readout}
          </div>
          <BackendStatus
            label={backend.label}
            detail={backend.detail}
            tone={backend.tone}
            className="ml-auto hidden sm:block xl:order-5 xl:ml-2"
          />
        </div>
      </div>
    </header>
  )
}
