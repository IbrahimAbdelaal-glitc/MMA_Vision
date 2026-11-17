import { useMemo, type ReactNode } from 'react'
import type { useLiveSession } from '../../hooks/useLiveSession'
import { useVideoClock } from '../../hooks/useVideoClock'
import { analysedInterval } from '../../services/liveClock'
import type { LocalVideoSource } from '../../types/dashboard'
import { liveTally, toStrikeEvent } from '../../utils/liveView'
import { FighterHud } from '../fighter-hud/FighterHud'
import { LiveMetricsPanel } from '../live-metrics/LiveMetricsPanel'
import { MonitoringControls } from '../live-metrics/MonitoringControls'
import { LatestEvent } from '../timeline/LatestEvent'
import { RecentDetections } from '../timeline/RecentDetections'
import { LiveOverlay } from '../video/LiveOverlay'
import { SourceChip } from '../video/StageLabels'
import { VideoStage } from '../video/VideoStage'

type LiveSession = ReturnType<typeof useLiveSession>

interface LiveMonitoringProps {
  source: LocalVideoSource | null
  /** The top-centre notice: the analysis job, or an invitation to analyse the preview. */
  notice: ReactNode
  video: HTMLVideoElement | null
  onVideoElement: (element: HTMLVideoElement | null) => void
  onSelectVideo: () => void
  onDropFile: (file: File) => void
  live: LiveSession
  /** Null when a live session can start now; otherwise why not. */
  startBlockedReason: string | null
}

/**
 * State one of the dashboard: the fight video with the fighter HUDs, metrics
 * and event panels around it.
 *
 * While a live session runs, every panel shows the live engine's results,
 * labelled provisional; without one, the panels render their empty states.
 * Where each panel sits is decided by the `.live-grid` rules in index.css.
 */
export function LiveMonitoring({
  source,
  notice,
  video,
  onVideoElement,
  onSelectVideo,
  onDropFile,
  live,
  startBlockedReason,
}: LiveMonitoringProps) {
  const { state } = live
  const clock = useVideoClock(video)
  const hasSession = state.phase !== 'idle' && state.phase !== 'uploading'
  const events = useMemo(() => state.events.map(toStrikeEvent), [state.events])
  const latest = events.at(-1) ?? null
  const meta = state.video

  const overlay =
    hasSession && meta ? (
      <LiveOverlay
        frame={state.frame}
        video={video}
        width={meta.width}
        height={meta.height}
        startOffsetMs={meta.startOffsetMs}
        intervalSeconds={analysedInterval(state.stats?.analysedRate ?? null, meta.fps)}
      />
    ) : null

  const uploadPercent = state.upload
    ? Math.min(100, Math.round((state.upload.loaded / Math.max(1, state.upload.total)) * 100))
    : null

  return (
    <div className="live-grid">
      <VideoStage
        source={source}
        onVideoElement={onVideoElement}
        onSelectVideo={onSelectVideo}
        onDropFile={onDropFile}
        overlay={overlay}
      />

      <SourceChip source={source} />

      {notice}

      {/* On full-height screens the Figma sets this panel 88 px lower. */}
      <aside className="area-metrics overlay:tall:mt-[88px]">
        <LiveMetricsPanel metrics={hasSession ? (state.frame?.metrics ?? null) : null} provisional={hasSession} />
        <MonitoringControls
          phase={state.phase}
          startBlockedReason={startBlockedReason}
          uploadPercent={uploadPercent}
          playing={clock.playing}
          connection={state.connection}
          device={state.device}
          stats={state.stats}
          endReason={state.endReason}
          onStart={() => source && live.start(source.file)}
          onTogglePlay={clock.toggle}
          onEnd={live.end}
          onSwap={live.swap}
          onAnalyse={() => void live.analyseOffline()}
          onDiscard={() => void live.discard()}
        />
      </aside>

      <FighterHud
        corner="blue"
        tally={hasSession ? liveTally(state.events, 'blue') : null}
        provisional={hasSession}
        trackingState={state.cornerStates?.blue ?? null}
        className="area-blue"
      />

      <div className="area-events">
        <LatestEvent event={latest} />
        <RecentDetections events={events} />
      </div>

      <FighterHud
        corner="red"
        tally={hasSession ? liveTally(state.events, 'red') : null}
        provisional={hasSession}
        trackingState={state.cornerStates?.red ?? null}
        className="area-red"
      />
    </div>
  )
}
