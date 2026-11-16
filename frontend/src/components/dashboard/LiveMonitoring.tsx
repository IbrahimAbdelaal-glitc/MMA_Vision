import type { ReactNode } from 'react'
import type { LocalVideoSource } from '../../types/dashboard'
import { FighterHud } from '../fighter-hud/FighterHud'
import { LiveMetricsPanel } from '../live-metrics/LiveMetricsPanel'
import { MonitoringControls } from '../live-metrics/MonitoringControls'
import { LatestEvent } from '../timeline/LatestEvent'
import { RecentDetections } from '../timeline/RecentDetections'
import { SourceChip } from '../video/StageLabels'
import { VideoStage } from '../video/VideoStage'

interface LiveMonitoringProps {
  source: LocalVideoSource | null
  /** The top-centre notice: the analysis job, or an invitation to analyse the preview. */
  notice: ReactNode
  onVideoElement: (element: HTMLVideoElement | null) => void
  onSelectVideo: () => void
  onDropFile: (file: File) => void
}

/**
 * State one of the dashboard: the fight video with the fighter HUDs, metrics
 * and event panels around it.
 *
 * The live engine is not connected yet, so the HUDs, metrics and event panels
 * receive no data and render their empty states, even while an offline
 * analysis job runs. Where each panel sits is decided by the `.live-grid`
 * rules in index.css.
 */
export function LiveMonitoring({
  source,
  notice,
  onVideoElement,
  onSelectVideo,
  onDropFile,
}: LiveMonitoringProps) {
  return (
    <div className="live-grid">
      <VideoStage
        source={source}
        onVideoElement={onVideoElement}
        onSelectVideo={onSelectVideo}
        onDropFile={onDropFile}
      />

      <SourceChip source={source} />

      {notice}

      {/* On full-height screens the Figma sets this panel 88 px lower. */}
      <aside className="area-metrics overlay:tall:mt-[88px]">
        <LiveMetricsPanel metrics={null} />
        <MonitoringControls unavailableReason="Unavailable: live engine not connected" />
      </aside>

      <FighterHud corner="blue" tally={null} className="area-blue" />

      <div className="area-events">
        <LatestEvent event={null} />
        <RecentDetections events={[]} />
      </div>

      <FighterHud corner="red" tally={null} className="area-red" />
    </div>
  )
}
