import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { AlertBar } from './components/common/AlertBar'
import { Readout } from './components/common/Readout'
import { StatusBar } from './components/common/StatusBar'
import { panelId, tabId } from './components/common/tabIds'
import { TopBar } from './components/common/TopBar'
import {
  backendIndicator,
  jobChip,
  jobSummary,
  NO_RESULTS_CHIP,
  NO_SOURCE_CHIP,
  PREVIEW_CHIP,
  shortJobId,
  stageFocus,
  statusBarText,
} from './components/dashboard/dashboardStatus'
import { LiveMonitoring } from './components/dashboard/LiveMonitoring'
import { MatchEnded } from './components/dashboard/MatchEnded'
import { JobProgress } from './components/job/JobProgress'
import { PlaybackReadout } from './components/video/PlaybackReadout'
import { ScrubRail } from './components/video/ScrubRail'
import { StageNotice } from './components/video/StageLabels'
import { useAnalysisJob } from './hooks/useAnalysisJob'
import { useBackendHealth } from './hooks/useBackendHealth'
import { useLocalVideo } from './hooks/useLocalVideo'
import { useReplayVideo } from './hooks/useReplayVideo'
import type { DashboardView } from './types/dashboard'
import { cx } from './utils/cx'

/**
 * MMA Vision: one dashboard with two states, Live Monitoring and Match Ended.
 *
 * This component owns what both states share: which state is showing, the
 * video the user chose, the analysis job, and the single hidden file input
 * every "Select MP4" button opens. Because these are kept here rather than
 * inside one state, switching between the states loses nothing.
 */
export default function App() {
  const [view, setView] = useState<DashboardView>('live')
  const localVideo = useLocalVideo()
  const health = useBackendHealth()
  // A finished job's results are what the user is waiting for, so show them.
  const analysis = useAnalysisJob({ onCompleted: () => setView('ended') })
  // Kept in state, not a ref, so the clock components re-subscribe whenever
  // the <video> element appears, is replaced, or goes away.
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const job = analysis.state
  // Kept here, not in Match Ended, so a copy chosen for the replay survives
  // switching to Live Monitoring and back.
  const replay = useReplayVideo(job)
  const source = localVideo.source
  const live = view === 'live'
  const focus = stageFocus(job, source)
  const backend = backendIndicator(health, job)
  const statusBar = statusBarText(view, job, focus)

  const openFilePicker = () => fileInput.current?.click()

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      localVideo.select(file)
      setView('live')
    }
    // Clear the input so choosing the same file again still fires a change.
    event.target.value = ''
  }

  const onDropFile = (file: File) => localVideo.select(file)

  const chip = live
    ? ((focus === 'job' ? jobChip(job) : null) ?? (source ? PREVIEW_CHIP : NO_SOURCE_CHIP))
    : (jobChip(job) ?? NO_RESULTS_CHIP)

  // The notice over the stage: the job while one runs or has run, otherwise
  // an invitation to analyse the video being previewed.
  let notice: ReactNode = null
  if (focus === 'job') {
    notice = <JobProgress job={job} onViewResults={() => setView('ended')} />
  } else if (focus === 'preview' && source) {
    notice = (
      <StageNotice
        label="Not analysed yet"
        message="This video is playing from your computer. Analyse video uploads it to the backend for the nine-stage offline analysis."
        action={
          <button
            type="button"
            onClick={() => analysis.analyse(source.file)}
            className="h-8 shrink-0 rounded-md bg-[#1b2c4a] px-3.5 text-xs font-semibold text-fg transition-colors hover:bg-control-hover"
          >
            Analyse video
          </button>
        }
      />
    )
  }

  return (
    <div className="flex h-dvh flex-col bg-ink text-fg">
      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,.mp4"
        aria-label="Select MP4 video"
        tabIndex={-1}
        onChange={onFileChosen}
        className="sr-only"
      />

      <TopBar
        view={view}
        onViewChange={setView}
        status={chip}
        readout={
          live ? (
            <PlaybackReadout video={videoElement} />
          ) : (
            <Readout label="Job" value={job.jobId ? shortJobId(job.jobId) : 'Not loaded'} />
          )
        }
        backend={{ label: backend.label, detail: jobSummary(job), tone: backend.tone }}
        onSelectVideo={openFilePicker}
      />

      {localVideo.error && (
        <AlertBar message={localVideo.error} onDismiss={localVideo.dismissError} />
      )}
      {job.uploadError && (
        <AlertBar
          message={`Upload failed: ${job.uploadError}`}
          onDismiss={analysis.dismissUploadError}
        />
      )}

      {live && <ScrubRail video={videoElement} />}

      <main className="relative min-h-0 flex-1 overflow-y-auto">
        <div
          role="tabpanel"
          id={panelId(view)}
          aria-labelledby={tabId(view)}
          className={cx(live && 'overlay:h-full')}
        >
          {live ? (
            <LiveMonitoring
              source={source}
              notice={notice}
              onVideoElement={setVideoElement}
              onSelectVideo={openFilePicker}
              onDropFile={onDropFile}
            />
          ) : (
            // A different job starts with nothing selected and the default views.
            <MatchEnded
              key={job.jobId ?? 'no-job'}
              job={job}
              replay={replay}
              onRetry={analysis.retryAnalysis}
            />
          )}
        </div>
      </main>

      <StatusBar
        label={statusBar.label}
        message={statusBar.message}
        backendLabel={backend.label}
        backendTone={backend.tone}
      />
    </div>
  )
}
