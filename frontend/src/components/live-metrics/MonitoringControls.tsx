import { ArrowLeftRight, FlaskConical, Pause, Play, Square, Trash2 } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { LiveConnection, LivePhase } from '../../hooks/useLiveSession'
import type { EndReason, InferencePath, LiveStats } from '../../types/live'
import { cx } from '../../utils/cx'
import { formatMeasure } from '../../utils/format'
import { engineLocation } from '../../utils/liveView'

interface MonitoringControlsProps {
  phase: LivePhase
  /** Null when Start can be pressed; otherwise why it cannot. */
  startBlockedReason: string | null
  uploadPercent: number | null
  playing: boolean
  connection: LiveConnection
  device: string | null
  inference: InferencePath | null
  stats: LiveStats | null
  endReason: EndReason | null
  onStart: () => void
  onTogglePlay: () => void
  onEnd: () => void
  onSwap: () => void
  onAnalyse: () => void
  onDiscard: () => void
}

const END_TEXT: Record<EndReason, string> = {
  video_end: 'The video ended.',
  stopped: 'Live analysis was ended.',
  disconnected: 'Ended after 60 s without this page connected.',
  crashed: 'The live engine stopped with an error. What it recorded is kept.',
}

/**
 * Start, pause and end a live session, swap the corners, and hand the
 * session over to the nine-stage offline analysis.
 *
 * The video is the engine's clock: Pause pauses the video and so the
 * analysis. Below the buttons are the engine's own reports: where it runs,
 * how many frames it analysed and skipped, and whether event detection is active.
 */
export function MonitoringControls(props: MonitoringControlsProps) {
  const { phase, startBlockedReason, uploadPercent, playing } = props
  const reasonId = useId()
  const running = phase === 'starting' || phase === 'live'

  let buttons: ReactNode
  if (phase === 'ended' || phase === 'handing-off') {
    const busy = phase === 'handing-off'
    buttons = (
      <div className="grid grid-cols-2 gap-2">
        <ControlButton label="Analyse offline" describedBy={reasonId} disabled={busy} onClick={props.onAnalyse} primary>
          <FlaskConical size={13} aria-hidden />
          {busy ? 'Handing over…' : 'Analyse offline'}
        </ControlButton>
        <ControlButton label="Discard live session" describedBy={reasonId} disabled={busy} onClick={props.onDiscard}>
          <Trash2 size={12} aria-hidden />
          Discard
        </ControlButton>
      </div>
    )
  } else if (phase === 'live') {
    buttons = (
      <div className="grid grid-cols-3 gap-2">
        <ControlButton
          label={playing ? 'Pause video and analysis' : 'Play video and analysis'}
          describedBy={reasonId}
          onClick={props.onTogglePlay}
          primary={!playing}
        >
          {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
          {playing ? 'Pause' : 'Play'}
        </ControlButton>
        <ControlButton label="Swap Blue and Red" describedBy={reasonId} onClick={props.onSwap}>
          <ArrowLeftRight size={13} aria-hidden />
          Swap
        </ControlButton>
        <ControlButton label="End live analysis" describedBy={reasonId} onClick={props.onEnd}>
          <Square size={11} aria-hidden />
          End
        </ControlButton>
      </div>
    )
  } else {
    const startLabel =
      phase === 'uploading' ? `Uploading ${uploadPercent ?? 0}%` : phase === 'starting' ? 'Loading model…' : 'Start live'
    buttons = (
      <div className="grid grid-cols-3 gap-2">
        <ControlButton
          label="Start live analysis"
          describedBy={reasonId}
          disabled={phase !== 'idle' || startBlockedReason !== null}
          onClick={props.onStart}
          primary
          className="col-span-2"
        >
          <Play size={13} aria-hidden />
          {startLabel}
        </ControlButton>
        <ControlButton
          label={phase === 'uploading' ? 'Cancel upload' : 'End live analysis'}
          describedBy={reasonId}
          disabled={phase === 'idle'}
          onClick={props.onEnd}
        >
          <Square size={11} aria-hidden />
          {phase === 'uploading' ? 'Cancel' : 'End'}
        </ControlButton>
      </div>
    )
  }

  let reason: string
  if (phase === 'idle') {
    reason =
      startBlockedReason ??
      'Uploads this video, checks its timing, then analyses it as it plays. Live values are provisional.'
  } else if (phase === 'uploading') {
    reason = 'Uploading the video and checking its frame timing.'
  } else if (phase === 'starting') {
    reason = 'Loading the pose model. The first start can take about 20 s.'
  } else if (phase === 'live') {
    reason = 'Play the video to analyse it. Seeking forward skips frames; the engine never goes back.'
  } else {
    reason = `${props.endReason ? END_TEXT[props.endReason] : 'Live analysis has ended.'} Analyse offline runs the nine-stage analysis on the same file; its scorecard is the final one.`
  }

  return (
    <div className="mt-2 rounded-lg border border-line-strong bg-hud/92 p-2 backdrop-blur-sm squat:border-0 squat:bg-transparent squat:p-0 squat:backdrop-blur-none">
      {buttons}
      <p id={reasonId} className="mt-1.5 px-0.5 text-[10px] leading-[13px] text-muted squat:sr-only">
        {reason}
      </p>
      {(running || phase === 'ended') && (
        <EngineStatus
          connection={props.connection}
          device={props.device}
          inference={props.inference}
          stats={props.stats}
        />
      )}
    </div>
  )
}

const CONNECTION_TEXT: Record<LiveConnection, string> = {
  none: 'Not connected',
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Closed',
}

function EngineStatus({
  connection,
  device,
  inference,
  stats,
}: {
  connection: LiveConnection
  device: string | null
  inference: InferencePath | null
  stats: LiveStats | null
}) {
  let detection = '—'
  if (stats) {
    detection = stats.detectionActive
      ? 'Active'
      : `Inactive: ${stats.detectionInactiveReason ?? 'not enough analysed frames'}`
  }
  const where = engineLocation(device, inference)
  return (
    <dl
      aria-label="Live engine status"
      className="mt-2 space-y-1 border-t border-line-strong/50 px-0.5 pt-2 text-[10px] leading-3 squat:hidden"
    >
      <Row label="Engine">
        {CONNECTION_TEXT[connection]}
        {where}
      </Row>
      <Row label="Frames analysed">
        {stats ? `${stats.framesAnalysed} · ${stats.framesSkipped} skipped` : '—'}
      </Row>
      <Row label="Analysed rate">
        {stats?.analysedRate == null ? '—' : `${formatMeasure(stats.analysedRate, 1)} frames/s`}
      </Row>
      <Row label="Event detection" warn={stats !== null && !stats.detectionActive}>
        {detection}
      </Row>
      {stats && stats.unscoredEventCount > 0 && (
        <Row label="Unscored (warm-up)">{String(stats.unscoredEventCount)}</Row>
      )}
    </dl>
  )
}

function Row({ label, warn = false, children }: { label: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={cx('text-right font-semibold tabular-nums', warn ? 'text-warn' : 'text-fg-soft')}>
        {children}
      </dd>
    </div>
  )
}

function ControlButton({
  label,
  describedBy,
  disabled = false,
  primary = false,
  onClick,
  className,
  children,
}: {
  label: string
  describedBy: string
  disabled?: boolean
  primary?: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={onClick}
      className={cx(
        'flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-semibold text-fg transition-colors disabled:opacity-45',
        primary ? 'bg-[#1b2c4a] enabled:hover:bg-control-hover' : 'bg-control enabled:hover:bg-control-hover',
        className,
      )}
    >
      {children}
    </button>
  )
}
