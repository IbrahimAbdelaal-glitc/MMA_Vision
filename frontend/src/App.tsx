import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  CircleDot,
  FileVideo,
  Gauge,
  Play,
  Zap,
} from 'lucide-react'
import { getCurrentJob, getHealth, getJobStatus, processedVideoUrl, startFolderAnalysis } from './services/api'
import { loadAnalysis } from './services/loadAnalysis'
import type { AnalysisData, JobStatus, Scorecard } from './types/api'
import { detectionLabel } from './utils/detectionLabel'

function formatTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--:--'
  const minutes = Math.floor(value / 60)
  const seconds = (value % 60).toFixed(2).padStart(5, '0')
  return `${String(minutes).padStart(2, '0')}:${seconds}`
}

function scoreTone(score: number | null): string {
  if (score === null) return 'text-slate-400'
  if (score >= 80) return 'text-brand'
  if (score >= 65) return 'text-slate-200'
  if (score >= 50) return 'text-slate-400'
  return 'text-slate-400'
}

type ReportRule = { label: string; points: number }

function parseScorecardReport(report: string): { rules: ReportRule[]; winner: string | null; note: string } {
  const rules: ReportRule[] = []
  const noteLines: string[] = []
  let section = ''
  let winner: string | null = null

  for (const rawLine of report.split(/\r?\n/)) {
    const line = rawLine.trim().replaceAll('Very Strong', 'Significant')
    if (!line || /^[-=]+$/.test(line)) continue
    const heading = line.toUpperCase()
    if (heading === 'SCORING RULES' || heading === 'IMPORTANT NOTE') {
      section = heading
      continue
    }
    if (heading === 'FIGHTER COMPARISON' || heading === 'EXPERIMENTAL STRIKE ACTIVITY SCORE') {
      section = heading
      continue
    }

    if (section === 'SCORING RULES') {
      const match = line.match(/^(.+?)\s+event:\s*(\d+)\s+points$/i)
      if (match) rules.push({ label: match[1], points: Number(match[2]) })
    } else if (section === 'EXPERIMENTAL STRIKE ACTIVITY SCORE') {
      if (/^(BLUE|RED) has the higher experimental strike activity score\.?$/i.test(line)) {
        winner = line.replace(/\.$/, '')
      }
    } else if (section === 'IMPORTANT NOTE') {
      noteLines.push(line)
    }
  }

  return {
    rules,
    winner,
    note: noteLines.join(' ').replace(/\s+/g, ' ').trim(),
  }
}

function ScorecardReport({ report, scorecard }: { report: string; scorecard: Scorecard | null }) {
  const details = parseScorecardReport(report)
  const rows = [
    { label: 'Detected strikes', key: 'totalEvents' as const },
    { label: 'Punch-like', key: 'punchLike' as const },
    { label: 'Kick-like', key: 'kickLike' as const },
    { label: 'Strong', key: 'strong' as const },
    { label: 'Significant', key: 'veryStrong' as const },
  ]
  const redScore = scorecard?.red?.activityScore
  const blueScore = scorecard?.blue?.activityScore
  const winner = details.winner ?? (redScore != null && blueScore != null && redScore !== blueScore
    ? `${redScore > blueScore ? 'RED' : 'BLUE'} has the higher experimental strike activity score`
    : null)

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0c0c0e]">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <div>
          <p className="text-[9px] font-bold tracking-[0.17em] text-brand uppercase">MMA Vision scorecard</p>
          <h4 className="mt-1 text-sm font-semibold text-white">Experimental activity breakdown</h4>
        </div>
        {winner && <p className="text-xs font-semibold text-slate-200">{winner}</p>}
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(210px,0.8fr)_minmax(0,1.8fr)]">
        <section className="rounded-lg border border-white/[0.055] bg-white/[0.02] p-3.5 sm:p-4">
          <h5 className="text-[9px] font-bold tracking-[0.14em] text-slate-400 uppercase">Scoring rules</h5>
          {details.rules.length > 0 ? <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5">
            {details.rules.map((rule) => <div key={rule.label} className="contents">
              <span className="text-xs text-slate-300">{rule.label}</span>
              <span className="text-xs font-semibold tabular-nums text-white">{rule.points} {rule.points === 1 ? 'point' : 'points'}</span>
            </div>)}
          </div> : <p className="mt-3 text-xs leading-5 text-slate-400">Activity scores use the report’s experimental strike classifications.</p>}
        </section>

        <section className="min-w-0 rounded-lg border border-white/[0.055] bg-white/[0.02] p-3.5 sm:p-4">
          <h5 className="text-[9px] font-bold tracking-[0.14em] text-slate-400 uppercase">Fighter comparison</h5>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse text-left">
              <thead><tr className="border-b border-white/[0.07] text-[9px] font-bold tracking-[0.1em] text-slate-500 uppercase">
                <th className="pb-2 pr-3 font-semibold">Activity</th>
                <th className="pb-2 px-3 text-right font-semibold text-sky-300">Blue corner</th>
                <th className="pb-2 pl-3 text-right font-semibold text-rose-300">Red corner</th>
              </tr></thead>
              <tbody>{rows.map((row) => <tr key={row.key} className="border-b border-white/[0.035] last:border-0">
                <th className="py-2 pr-3 text-xs font-medium text-slate-300">{row.label}</th>
                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-100">{scorecard?.blue?.[row.key] ?? '—'}</td>
                <td className="py-2 pl-3 text-right text-xs font-semibold tabular-nums text-slate-100">{scorecard?.red?.[row.key] ?? '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {([
              { label: 'Blue activity score', value: blueScore, tone: 'text-sky-300' },
              { label: 'Red activity score', value: redScore, tone: 'text-rose-300' },
            ]).map((score) => <div key={score.label} className="flex items-center justify-between rounded-md border border-white/[0.05] bg-black/15 px-3 py-2">
              <span className="text-[10px] text-slate-400">{score.label}</span>
              <span className={`text-sm font-bold tabular-nums ${score.tone}`}>{score.value ?? '—'}</span>
            </div>)}
          </div>
        </section>
      </div>

      {details.note && <p className="border-t border-white/[0.06] px-4 py-3.5 text-xs leading-5 text-slate-400 sm:px-5">{details.note}</p>}
    </div>
  )
}

export default function App() {
  const [backend, setBackend] = useState<'checking' | 'online' | 'offline'>('checking')
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const audioBufferPromiseRef = useRef<Promise<AudioBuffer> | null>(null)
  const playedCompletionJobRef = useRef<string | null>(null)

  const prepareFightBell = useCallback(async () => {
    if (typeof window.AudioContext === 'undefined') return false
    const context = audioContextRef.current ?? new window.AudioContext()
    audioContextRef.current = context
    const resumePromise = context.state === 'suspended' ? context.resume() : Promise.resolve()
    if (!audioBufferPromiseRef.current) {
      audioBufferPromiseRef.current = fetch('/fight-bell.mp3')
        .then((response) => {
          if (!response.ok) throw new Error('Fight bell audio could not be loaded.')
          return response.arrayBuffer()
        })
        .then((data) => context.decodeAudioData(data))
        .catch((loadError: unknown) => {
          audioBufferPromiseRef.current = null
          throw loadError
        })
    }
    try {
      const [_, buffer] = await Promise.all([resumePromise, audioBufferPromiseRef.current])
      audioBufferRef.current = buffer
      const ready = context.state === 'running'
      setAudioReady(ready)
      return ready
    } catch {
      setAudioReady(false)
      return false
    }
  }, [])

  const playFightBell = useCallback(() => {
    const context = audioContextRef.current
    const buffer = audioBufferRef.current
    if (!context || context.state !== 'running' || !buffer) return
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.start()
  }, [])

  const replayFightBell = useCallback(async () => {
    if (await prepareFightBell()) playFightBell()
  }, [playFightBell, prepareFightBell])

  useEffect(() => {
    const unlockAudio = () => { void prepareFightBell() }
    document.addEventListener('pointerdown', unlockAudio, { once: true })
    document.addEventListener('keydown', unlockAudio, { once: true })
    return () => {
      document.removeEventListener('pointerdown', unlockAudio)
      document.removeEventListener('keydown', unlockAudio)
    }
  }, [prepareFightBell])

  const refreshStatus = useCallback(async (id: string, signal?: AbortSignal) => {
    const next = await getJobStatus(id, signal)
    if (signal?.aborted) return
    setStatus(next)
    if (next.status === 'completed') {
      const data = await loadAnalysis(id, signal ?? new AbortController().signal)
      if (signal?.aborted) return
      setAnalysis(data)
    }
    if (next.status === 'failed') setError(next.error ?? 'The analysis failed. Check the backend pipeline log.')
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getHealth(controller.signal), getCurrentJob(controller.signal)])
      .then(async ([, id]) => {
        if (controller.signal.aborted) return
        setBackend('online')
        setJobId(id)
        await refreshStatus(id, controller.signal)
      })
      .catch(async (healthError: unknown) => {
        // React StrictMode can abort the first development-only effect run.
        // That cancellation is expected and must not become a dashboard error.
        if (controller.signal.aborted) return
        try {
          await getHealth(controller.signal)
        } catch {
          if (controller.signal.aborted) return
          setBackend('offline')
        }
        if (controller.signal.aborted) return
        setBackend('online')
        // No previous analysis is a normal first-run state (HTTP 404).
        if (healthError instanceof Error && !healthError.message.toLowerCase().includes('404')) {
          setError(healthError.message)
        }
      })
    return () => controller.abort()
  }, [refreshStatus])

  useEffect(() => {
    if (!jobId || status?.status === 'completed' || status?.status === 'failed') return
    const timer = window.setInterval(() => {
      void refreshStatus(jobId).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not read analysis status.'))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [jobId, status?.status, refreshStatus])

  const start = async () => {
    void prepareFightBell()
    setStarting(true)
    setError(null)
    setAnalysis(null)
    try {
      const result = await startFolderAnalysis()
      setJobId(result.jobId)
      setStatus(null)
      await refreshStatus(result.jobId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start analysis.')
    } finally {
      setStarting(false)
    }
  }

  const eventsPart = analysis?.events
  const resultsPart = analysis?.results
  const artifactsPart = analysis?.artifacts
  const events = eventsPart?.state === 'ready' ? eventsPart.data.events : []
  const scorecard = resultsPart?.state === 'ready' ? resultsPart.data.scorecard : null
  const artifacts = artifactsPart?.state === 'ready' ? artifactsPart.data : []
  const completed = status?.status === 'completed'
  const stagesFinished = completed && (
    status.stagesCompleted === null || status.stagesCompleted === undefined
      ? status.progress === 100
      : status.stagesCompleted >= 9
  )
  const active = status?.status === 'queued' || status?.status === 'processing'

  useEffect(() => {
    if (!stagesFinished || !jobId || !audioReady || playedCompletionJobRef.current === jobId) return
    playedCompletionJobRef.current = jobId
    void replayFightBell()
  }, [audioReady, jobId, replayFightBell, stagesFinished])

  return (
    <div className="mma-backdrop min-h-dvh text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#09090a]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[15px] font-bold tracking-[0.16em] text-white">MMA VISION</p>
              <p className="mt-0.5 text-[10px] font-medium tracking-[0.18em] text-slate-500 uppercase">Fight intelligence</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3.5 py-2 sm:flex">
              <span className={`status-light ${backend === 'online' ? 'status-light-on' : backend === 'offline' ? 'status-light-off' : ''}`} />
              <span className="text-xs font-medium capitalize text-slate-300">{backend === 'online' ? 'Backend online' : backend === 'offline' ? 'Backend offline' : 'Connecting'}</span>
            </div>
            <button
              onClick={start}
              disabled={starting || active || backend !== 'online'}
              className="fight-cta inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Play size={14} fill="currentColor" aria-hidden />
              {starting ? 'Starting…' : active ? 'Analysis running…' : 'Start analysis'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 px-5 py-8 lg:space-y-7 lg:px-8 lg:py-10">
        <section className="animate-enter flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold tracking-[0.22em] text-brand uppercase">
              <Activity size={13} aria-hidden /> Video analytics workspace
            </p>
            <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-white sm:text-4xl lg:text-[42px]">
              Fight intelligence, <span className="text-brand">at a glance.</span>
            </h1>
          </div>
          <div className="mb-1 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[10px] font-semibold tracking-[0.13em] text-slate-500 uppercase">
            <CircleDot size={13} className="text-brand" aria-hidden /> Single-fight analysis
          </div>
        </section>

        <section className="animate-enter delay-1 panel-glow overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151516]/90">
          <div className="flex flex-wrap items-center justify-between gap-5 p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.045] text-slate-200">
                <FileVideo size={20} aria-hidden />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-sm font-semibold text-white">Offline video analysis</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold tracking-[0.12em] uppercase ${active ? 'bg-sky-400/10 text-sky-300' : completed ? 'bg-emerald-400/10 text-emerald-300' : status?.status === 'failed' ? 'bg-rose-400/10 text-rose-300' : 'bg-white/[0.06] text-slate-400'}`}>
                    {active ? 'In progress' : completed ? 'Complete' : status?.status === 'failed' ? 'Failed' : 'Ready'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-400">Analyzes the MP4 video in <code className="rounded bg-black/25 px-1.5 py-0.5 text-[11px] text-slate-300">videos/input/</code> and builds a detailed fight report.</p>
              </div>
            </div>
            <div className="min-w-[190px] text-left sm:text-right">
              <p className="text-[9px] font-bold tracking-[0.16em] text-slate-500 uppercase">Current session</p>
              <p className="mt-1.5 truncate text-sm font-medium text-slate-200">{status?.originalFilename ?? 'No analysis selected'}</p>
              <p className="mt-1 text-xs text-brand">{status?.currentStage ?? 'Ready to analyze'}</p>
            </div>
          </div>
          {status && (
            <div className="border-t border-white/[0.06] px-5 py-4 sm:px-6">
              <div className="mb-2.5 flex items-center justify-between text-[10px] font-semibold tracking-wide text-slate-400">
                <span>{status.stagesCompleted ?? 0} / {status.totalStages ?? 9} stages</span>
                <span className="tabular-nums text-slate-200">{status.progress ?? 0}%</span>
              </div>
              <div className="progress-track h-1.5 overflow-hidden rounded-full bg-slate-800/90">
                <div className="progress-fill h-full rounded-full bg-gradient-to-r from-brand to-rose-300 transition-[width] duration-700 ease-out" style={{ width: `${status.progress ?? 0}%` }} />
              </div>
            </div>
          )}
          {error && <p role="alert" className="mx-5 mb-5 rounded-xl border border-rose-400/20 bg-rose-400/[0.08] p-3.5 text-sm text-rose-200 sm:mx-6">{error}</p>}
          {!jobId && !error && <p className="border-t border-white/[0.06] px-5 py-3.5 text-xs text-slate-500 sm:px-6">Place one MP4 in <code className="text-slate-300">videos/input/</code>, then start the analysis.</p>}
        </section>

        <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.85fr)]">
          <div className="animate-enter delay-2 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b0b0d] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
            <div className="flex items-center justify-between border-b border-white/[0.07] bg-[#151516] px-4 py-3.5 sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="size-1.5 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.8)]" />
                <h2 className="text-[10px] font-bold tracking-[0.17em] text-slate-200 uppercase">Fight footage</h2>
              </div>
              <span className="text-[9px] font-semibold tracking-[0.13em] text-slate-500 uppercase">Annotated replay</span>
            </div>
            {completed && jobId ? (
              <video key={jobId} controls playsInline onPlay={() => { void prepareFightBell() }} onEnded={() => { void replayFightBell() }} className="aspect-video w-full bg-black" src={processedVideoUrl(jobId)} />
            ) : (
              <div className="stage-empty relative flex aspect-video items-center justify-center overflow-hidden p-8 text-center">
                <div className="relative z-10 max-w-sm">
                  <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-500">
                    <Play size={20} aria-hidden />
                  </span>
                  <p className="mt-4 text-sm font-semibold text-slate-300">{active ? 'Your replay is being prepared' : 'Your fight replay will appear here'}</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">{active ? 'The annotated video becomes available as soon as analysis finishes.' : 'Run an analysis to review the annotated footage and detected moments.'}</p>
                </div>
              </div>
            )}
          </div>

          <aside className="animate-enter delay-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151516]/95 xl:sticky xl:top-[88px]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-4 sm:px-5">
              <div>
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-brand" aria-hidden />
                  <h2 className="text-xs font-bold tracking-[0.14em] text-white uppercase">Detected strikes</h2>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">Classified movement candidates</p>
              </div>
              <span className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5 text-xs font-bold tabular-nums text-slate-200">{events.length.toString().padStart(2, '0')}</span>
            </div>
            <div className="max-h-[440px] space-y-2 overflow-y-auto p-3 sm:p-4">
              {events.length === 0 ? (
                <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-white/[0.09] px-6 text-center">
                  <div>
                    <span className="mx-auto grid size-10 place-items-center rounded-xl bg-white/[0.04] text-slate-500"><Zap size={17} aria-hidden /></span>
                    <p className="mt-3 text-xs font-medium text-slate-300">No strikes to review yet</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">Detected moments will appear here after analysis.</p>
                  </div>
                </div>
              ) : events.slice().sort((a, b) => (a.peakTime ?? Infinity) - (b.peakTime ?? Infinity)).map((event, index) => (
                <div key={event.id} className={`event-card flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#111113] px-3.5 py-3 transition hover:border-white/[0.14] hover:bg-[#1d1d20] ${event.corner === 'red' ? 'event-card-red' : 'event-card-blue'}`} style={{ animationDelay: `${Math.min(index * 55, 550)}ms` }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`size-1.5 rounded-full ${event.corner === 'red' ? 'bg-rose-400' : 'bg-sky-400'}`} />
                      <span className={`text-[9px] font-bold tracking-[0.13em] uppercase ${event.corner === 'red' ? 'text-rose-300' : 'text-sky-300'}`}>{event.corner} corner</span>
                      <span className="text-[10px] tabular-nums text-slate-500">{formatTime(event.peakTime)}</span>
                    </div>
                    <p className="mt-1.5 truncate text-xs font-semibold text-slate-200">{event.eventType} <span className="font-normal text-slate-500">· {event.side}</span></p>
                    <span className={`mt-1.5 inline-flex rounded-md px-2 py-1 text-[9px] font-bold tracking-wide ${event.detectionClass === 'Very Strong' ? 'bg-amber-300/[0.09] text-amber-200' : 'bg-white/[0.05] text-slate-400'}`}>{detectionLabel(event.detectionClass)}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xl font-semibold tabular-nums ${scoreTone(event.kinematicScore)}`}>{event.kinematicScore ?? '—'}</p>
                    <p className="text-[8px] font-semibold tracking-[0.12em] text-slate-600 uppercase">Score / 100</p>
                  </div>
                </div>
              ))}
            </div>
            {events.length > 0 && <p className="border-t border-white/[0.06] px-4 py-3 text-[10px] leading-4 text-slate-500 sm:px-5">Scores are heuristic movement rankings, not confirmation of a landed strike.</p>}
          </aside>
        </section>

        {completed && <section className="animate-enter space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold tracking-[0.2em] text-brand uppercase">Fight report</p>
              <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-white">Analysis summary</h2>
            </div>
            <span className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">Experimental activity scoring</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {(['blue', 'red'] as const).map((corner, index) => {
              const row = scorecard?.[corner]
              const label = corner === 'red' ? 'Red corner' : 'Blue corner'
              return <article key={corner} className={`summary-card animate-enter rounded-2xl border bg-[#151516]/90 p-5 sm:p-6 ${corner === 'red' ? 'summary-red' : 'summary-blue'}`} style={{ animationDelay: `${160 + index * 90}ms` }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`grid size-10 shrink-0 place-items-center rounded-xl border ${corner === 'red' ? 'border-rose-400/20 bg-rose-400/[0.08]' : 'border-white/10 bg-white/[0.055]'}`}>
                      <img src={corner === 'red' ? '/fighter-red-fist.png' : '/fighter-blue-fist.png'} alt="" className="size-9 object-contain drop-shadow-[0_2px_5px_rgba(0,0,0,0.55)]" />
                    </span>
                    <div><p className="text-[9px] font-bold tracking-[0.16em] text-slate-500 uppercase">Fighter</p><h3 className="mt-1 text-sm font-semibold text-slate-100">{label}</h3></div>
                  </div>
                  <div className="text-right"><p className="text-[9px] font-bold tracking-[0.13em] text-slate-500 uppercase">Activity score</p><p className="mt-0.5 text-2xl font-semibold tabular-nums text-white">{row?.activityScore ?? '—'}</p></div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Detected strikes', value: row?.totalEvents },
                    { label: 'Punch-like', value: row?.punchLike },
                    { label: 'Kick-like', value: row?.kickLike },
                    { label: 'Significant', value: row?.veryStrong },
                  ].map((metric) => <div key={metric.label} className="rounded-xl border border-white/[0.055] bg-black/15 px-3 py-3">
                    <p className="text-[9px] font-medium text-slate-500">{metric.label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{metric.value ?? '—'}</p>
                  </div>)}
                </div>
              </article>
            })}
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151516]/85">
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-5 py-4">
              <Gauge size={15} className="text-brand" aria-hidden />
              <h3 className="text-[10px] font-bold tracking-[0.15em] text-slate-200 uppercase">Analysis files &amp; notes</h3>
            </div>
            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap gap-2">{artifacts.map(file => <a key={file.path} href={file.href} className="rounded-lg border border-white/[0.09] bg-white/[0.025] px-3 py-2 text-[11px] font-medium text-slate-300 transition hover:border-sky-400/30 hover:bg-sky-400/[0.06] hover:text-white">{file.name}</a>)}</div>
              {analysis?.results.state === 'ready' && analysis.results.data.report && <ScorecardReport report={analysis.results.data.report} scorecard={analysis.results.data.scorecard} />}
            </div>
          </div>
        </section>}
      </main>

      <footer className="border-t border-white/[0.06] bg-black/10 px-5 py-5 text-center text-[10px] text-slate-600">
        <span className="font-semibold tracking-[0.12em] text-slate-500">MMA VISION</span><span className="mx-2">·</span>Offline computer vision analysis<span className="mx-2">·</span>Experimental results, not official fight judging
      </footer>
    </div>
  )
}
