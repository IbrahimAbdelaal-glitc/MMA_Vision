import { useMemo, useState, type ReactNode } from 'react'
import { ARTIFACT_PATHS, fileNameOf, findArtifact } from '../../services/artifactPaths'
import type { Artifact, MovementReport, MovementSeries, Part, SpeedFigures } from '../../types/api'
import { formatClock, formatGrouped } from '../../utils/format'
import { LineChart, type LineSeries } from '../charts/LineChart'
import { NEUTRAL_SERIES, SERIES_COLORS } from '../charts/series'
import { Swatch } from '../charts/Swatch'
import { Segmented } from '../common/Segmented'
import { FileLink } from './FileLink'

type MetricId = 'speed' | 'wrist' | 'distance' | 'total'

interface Metric {
  id: MetricId
  tab: string
  title: string
  description: string
  unit: 'px/s' | 'px'
  /** The PNG src/analyze_movement.py draws from the same column. */
  chartPath: string
  lines: (series: MovementSeries) => LineSeries[]
}

function fighters(blue: Array<number | null>, red: Array<number | null>): LineSeries[] {
  return [
    { id: 'blue', label: 'Blue', color: SERIES_COLORS.blue, values: blue },
    { id: 'red', label: 'Red', color: SERIES_COLORS.red, values: red },
  ]
}

/** The backend's four movement charts, in its own order, from the same columns it plots. */
const METRICS: readonly Metric[] = [
  {
    id: 'speed',
    tab: 'Movement speed',
    title: 'Fighter movement speed',
    description: 'How fast each fighter’s bounding-box centre moved.',
    unit: 'px/s',
    chartPath: ARTIFACT_PATHS.speedChart,
    lines: (series) => fighters(series.blueSpeed, series.redSpeed),
  },
  {
    id: 'wrist',
    tab: 'Wrist speed',
    title: 'Wrist movement activity',
    description:
      'Mean speed of the wrists the pose model saw clearly in two frames running, for each fighter.',
    unit: 'px/s',
    chartPath: ARTIFACT_PATHS.wristChart,
    lines: (series) => fighters(series.blueWrist, series.redWrist),
  },
  {
    id: 'distance',
    tab: 'Distance',
    title: 'Distance between fighters',
    description: 'Distance between the two fighters’ bounding-box centres.',
    unit: 'px',
    chartPath: ARTIFACT_PATHS.distanceChart,
    lines: (series) => [
      { id: 'distance', label: 'Distance', color: NEUTRAL_SERIES, values: series.distance },
    ],
  },
  {
    id: 'total',
    tab: 'Cumulative movement',
    title: 'Cumulative fighter movement',
    description: 'How far each bounding-box centre has travelled since the first frame.',
    unit: 'px',
    chartPath: ARTIFACT_PATHS.cumulativeChart,
    lines: (series) => fighters(series.blueTotal, series.redTotal),
  },
]

interface MovementChartsProps {
  series: Part<MovementSeries>
  report: Part<MovementReport>
  artifacts: Part<Artifact[]>
  /** The replay, when one is loaded: its position is drawn on the chart. */
  video: HTMLVideoElement | null
}

/**
 * The movement stage's output over time: one of its four charts, redrawn
 * from movement_metrics_cleaned.csv so it can be read frame by frame, with
 * the figures of movement_report.txt beside it and the backend's own PNG one
 * click away. All values are in pixels of the video frame, not real-world
 * distances.
 */
export function MovementCharts({ series, report, artifacts, video }: MovementChartsProps) {
  const [metricId, setMetricId] = useState<MetricId>('speed')
  const metric = METRICS.find((candidate) => candidate.id === metricId) ?? METRICS[0]
  const lines = useMemo(
    () => (series.state === 'ready' ? metric.lines(series.data) : null),
    [series, metric],
  )
  const chartFile = artifacts.state === 'ready' ? findArtifact(artifacts.data, metric.chartPath) : null

  return (
    <section
      id="movement-over-time"
      aria-label="Movement over time"
      className="rounded-lg border border-line bg-panel"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4">
        <div className="min-w-0 basis-64">
          <h2 className="text-[17px] leading-[21px] font-semibold">Movement over time</h2>
          <p className="mt-1 text-[11px] leading-[14px] text-muted">
            Per-frame values from movement_metrics_cleaned.csv, smoothed by the backend. Measured in
            pixels of the video frame, not real-world distance.
          </p>
        </div>
        <Segmented
          label="Movement measure"
          value={metricId}
          onChange={setMetricId}
          options={METRICS.map((candidate) => ({ value: candidate.id, label: candidate.tab }))}
        />
      </header>

      <div className="px-5 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm leading-[18px] font-semibold">{metric.title}</h3>
          {lines && lines.length > 1 && (
            <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-[14px] text-fg-soft">
              {lines.map((line) => (
                <li key={line.id} className="inline-flex items-center gap-1.5">
                  <Swatch color={line.color} shape="line" />
                  {line.label}
                </li>
              ))}
              {video && (
                <li className="inline-flex items-center gap-1.5">
                  <Swatch color="var(--color-ended)" shape="line" />
                  Replay position
                </li>
              )}
            </ul>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-[14px] text-muted">{metric.description}</p>

        <div className="mt-3">
          {series.state === 'ready' && lines ? (
            series.data.time.length > 0 ? (
              <LineChart
                title={metric.title}
                time={series.data.time}
                series={lines}
                unit={metric.unit}
                decimals={1}
                video={video}
              />
            ) : (
              <p className="py-6 text-[11px] leading-[14px] text-muted">
                movement_metrics_cleaned.csv has no frames to chart.
              </p>
            )
          ) : (
            <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-[11px] leading-[14px] text-muted">
              {series.state === 'ready' ? '' : series.message}
            </p>
          )}
        </div>
      </div>

      <div className="mx-5 mt-4 border-t border-line pt-3">
        <h3 className="text-[10px] leading-[13px] font-semibold text-fg-soft">
          From movement_report.txt
        </h3>
        <ReportFigures metric={metric.id} report={report} />
      </div>

      <div className="space-y-2 px-5 pt-3 pb-4 text-[11px] leading-[14px]">
        {series.state === 'ready' && series.data.skippedRows > 0 && (
          <p className="text-warn">
            {series.data.skippedRows} rows of movement_metrics_cleaned.csv had no readable time and are
            not charted.
          </p>
        )}
        {chartFile && (
          <p className="flex flex-wrap items-center gap-x-2 text-muted">
            The backend’s own chart of this measure:
            <FileLink file={chartFile} />
          </p>
        )}
        {chartFile && <BackendChart key={chartFile.path} file={chartFile} title={metric.title} />}
        {series.state === 'ready' && lines && series.data.time.length > 0 && (
          <FrameTable time={series.data.time} lines={lines} unit={metric.unit} />
        )}
      </div>
    </section>
  )
}

function ReportFigures({ metric, report }: { metric: MetricId; report: Part<MovementReport> }) {
  if (report.state !== 'ready') {
    return <p className="mt-1.5 text-[11px] leading-[14px] text-muted">{report.message}</p>
  }
  const { blue, red, distance } = report.data
  switch (metric) {
    case 'speed':
      return <SpeedTable blue={blue.movementSpeed} red={red.movementSpeed} />
    case 'wrist':
      return <SpeedTable blue={blue.wristSpeed} red={red.wristSpeed} />
    case 'distance':
      return (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-3">
            <Figure label="Average">{pixels(distance.averagePx)}</Figure>
            <Figure label="Minimum">{pixels(distance.minimumPx)}</Figure>
            <Figure label="Maximum">{pixels(distance.maximumPx)}</Figure>
          </dl>
          <p className="mt-2 text-[10px] leading-[13px] text-muted">
            The report computes these from the unsmoothed distance, so they can differ slightly from
            the smoothed line above.
          </p>
        </>
      )
    case 'total':
      return (
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <Figure label="Blue total movement" swatch={SERIES_COLORS.blue}>
            {pixels(blue.totalMovementPx)}
          </Figure>
          <Figure label="Red total movement" swatch={SERIES_COLORS.red}>
            {pixels(red.totalMovementPx)}
          </Figure>
        </dl>
      )
  }
}

function pixels(value: number | null): string {
  return value === null ? '—' : `${formatGrouped(value, 2)} px`
}

function speed(value: number | null): string {
  return value === null ? '—' : `${formatGrouped(value, 2)} px/s`
}

function SpeedTable({ blue, red }: { blue: SpeedFigures; red: SpeedFigures }) {
  const rows: ReadonlyArray<readonly [string, string, SpeedFigures]> = [
    ['Blue', SERIES_COLORS.blue, blue],
    ['Red', SERIES_COLORS.red, red],
  ]
  return (
    <table className="mt-1.5 w-full max-w-md border-collapse text-left text-xs leading-4">
      <thead>
        <tr className="text-[9px] leading-[11px] tracking-[0.6px] text-muted uppercase">
          <th scope="col" className="py-1.5 pr-3 font-semibold">
            <span className="sr-only">Fighter</span>
          </th>
          <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Median</th>
          <th scope="col" className="py-1.5 text-right font-semibold">95th percentile</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, color, figures]) => (
          <tr key={name} className="border-t border-line/70">
            <th scope="row" className="py-1.5 pr-3 font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <Swatch color={color} />
                {name}
              </span>
            </th>
            <td className="py-1.5 pr-3 text-right tabular-nums">{speed(figures.median)}</td>
            <td className="py-1.5 text-right tabular-nums">{speed(figures.p95)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Figure({ label, swatch, children }: { label: string; swatch?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="inline-flex items-center gap-1.5 text-[10px] leading-[13px] text-muted">
        {swatch && <Swatch color={swatch} />}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm leading-[18px] font-semibold tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * The backend's own matplotlib chart, for comparison with the redrawn one.
 * The image is only requested once the disclosure is opened.
 */
function BackendChart({ file, title }: { file: Artifact; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-fg-soft select-none hover:text-fg">
        Show the backend’s chart image
      </summary>
      {open && (
        <img
          src={file.href}
          alt={`${title}, as drawn by the backend in ${fileNameOf(file.path)}.`}
          className="mt-2 w-full rounded-md border border-line bg-white"
        />
      )}
    </details>
  )
}

/** Every plotted value as a table: the chart's accessible alternative. Rendered only when opened. */
function FrameTable({
  time,
  lines,
  unit,
}: {
  time: readonly number[]
  lines: readonly LineSeries[]
  unit: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-fg-soft select-none hover:text-fg">
        Table of the plotted values ({time.length} frames)
      </summary>
      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-line">
          <table className="w-full border-collapse text-left text-[11px] leading-[14px]">
            <thead className="sticky top-0 bg-panel-raised">
              <tr className="text-[9px] leading-[11px] tracking-[0.6px] text-muted uppercase">
                <th scope="col" className="px-3 py-1.5 font-semibold">Time</th>
                {lines.map((line) => (
                  <th key={line.id} scope="col" className="px-3 py-1.5 text-right font-semibold">
                    {line.label} ({unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {time.map((seconds, frame) => (
                <tr key={frame} className="border-t border-line/60">
                  <th scope="row" className="px-3 py-1 font-normal tabular-nums">
                    {formatClock(seconds)}
                  </th>
                  {lines.map((line) => (
                    <td key={line.id} className="px-3 py-1 text-right tabular-nums">
                      {formatGrouped(line.values[frame], 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}
