import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { FakeBackend, jsonReply, PROXY_FAILURE, textReply, type FakeJob } from './test/fakeBackend'
import {
  ARTIFACT_FILES,
  ARTIFACTS,
  artifactsResponse,
  COMPLETED_STATUS,
  FAILED_STATUS,
  JOB_ID,
  PROCESSING_STATUS,
  QUEUED_STATUS,
  RESULT_FILES,
  RESULTS,
} from './test/fixtures/realJob'

/*
 * The dashboard against an in-memory backend that answers like api/main.py,
 * with the data of a real pipeline run. Only fetch and XMLHttpRequest are
 * replaced; every component, hook and service runs as it does in the browser.
 */

const CLASSIFIED = 'results/classified_strike_candidates.csv'

let backend: FakeBackend

beforeEach(() => {
  URL.createObjectURL = () => 'blob:mma-vision-test'
  URL.revokeObjectURL = () => {}
  backend = new FakeBackend().install()
})

function mp4(name = 'title-fight.mp4') {
  return new File(['0'.repeat(2048)], name, { type: 'video/mp4' })
}

/** The real completed job as the backend serves it, with any part replaced. */
function completedJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    statuses: [COMPLETED_STATUS],
    results: jsonReply(200, RESULTS),
    artifacts: jsonReply(200, ARTIFACTS),
    files: Object.fromEntries(
      Object.entries(RESULT_FILES).map(([path, text]) => [path, textReply(200, text)]),
    ),
    ...overrides,
  }
}

/** The text of every cell of the event table's rows, header row left out. */
function eventRows(): string[][] {
  const table = screen.getByRole('region', { name: 'Event timeline and detailed statistics' })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim() ?? ''))
}

/** Waits for Match Ended to show the events of the run. */
async function waitForEvents() {
  const table = await screen.findByRole('region', { name: 'Event timeline and detailed statistics' })
  await within(table).findByRole('button', { name: /^00:00\.617 Red/ })
  return table
}

/** Records every seek the dashboard makes on a <video>; jsdom has no media engine. */
function recordSeeks(video: HTMLElement): number[] {
  const seeks: number[] = []
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => seeks.at(-1) ?? 0,
    set: (seconds: number) => {
      seeks.push(seconds)
    },
  })
  return seeks
}

/** The backend indicator in the top bar. */
function backendStatus() {
  return screen.getByRole('status', { name: 'Backend status' })
}

/** Renders the dashboard and waits for its backend check to settle. */
async function renderApp(): Promise<UserEvent> {
  const user = userEvent.setup()
  render(<App />)
  await within(backendStatus()).findByText(/^Backend (connected|unreachable)$/)
  return user
}

/** Opens a job the way a reload or a shared link does: ?job=<id>. */
async function openJobFromAddress(jobId = JOB_ID) {
  window.history.replaceState(null, '', `/?job=${jobId}`)
  return renderApp()
}

async function chooseAndAnalyse(user: UserEvent) {
  await user.upload(screen.getByLabelText('Select MP4 video'), mp4())
  await user.click(screen.getByRole('button', { name: 'Analyse video' }))
}

function jobPanel() {
  return screen.findByRole('region', { name: 'Analysis job' })
}

/** The Blue and Red cells of one row of the comparison table. */
function comparison(label: string): string[] {
  const table = screen.getByRole('region', { name: 'Final event comparison' })
  const row = within(table).getByRole('row', { name: new RegExp(`^${label}`) })
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '')
}

describe('uploading and following an analysis job', () => {
  it('uploads the chosen video and shows the status the backend reports', async () => {
    backend.acceptUploadAs(JOB_ID, { statuses: [PROCESSING_STATUS] })
    const user = await renderApp()

    await chooseAndAnalyse(user)

    const panel = await jobPanel()
    await within(panel).findByText('Starting pipeline')
    expect(panel).toHaveTextContent(/processing/i)
    expect(panel).toHaveTextContent('0 of 9 stages complete')
    expect(within(panel).getByRole('progressbar', { name: 'Analysis progress' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    expect(backend.uploads).toMatchObject([{ method: 'POST', url: '/api/jobs', fields: ['file'] }])
    expect(backend.requests).toContain(`GET /api/jobs/${JOB_ID}`)
    expect(window.location.search).toBe(`?job=${JOB_ID}`)
  })

  it('follows the stages as the backend reports them during the run', async () => {
    // What api/main.py writes when pipeline.py prints "RUNNING: Movement Data
    // Analysis" and, later, "RUNNING: Pose Estimation".
    backend.acceptUploadAs(JOB_ID, {
      statuses: [
        { ...PROCESSING_STATUS, current_stage: 'Movement Data Analysis', progress: 11, stages_completed: 1 },
        { ...PROCESSING_STATUS, current_stage: 'Pose Estimation', progress: 22, stages_completed: 2 },
      ],
    })
    const user = await renderApp()
    await chooseAndAnalyse(user)

    const panel = await jobPanel()
    await within(panel).findByText('Movement Data Analysis')
    expect(panel).toHaveTextContent('1 of 9 stages complete')
    const bar = within(panel).getByRole('progressbar', { name: 'Analysis progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '11')

    // The next check, 2.5 s later.
    await within(panel).findByText('Pose Estimation', {}, { timeout: 4000 })
    expect(panel).toHaveTextContent('2 of 9 stages complete')
    expect(within(panel).getByRole('progressbar', { name: 'Analysis progress' })).toHaveAttribute(
      'aria-valuenow',
      '22',
    )
  }, 10_000)

  it('shows no percentage when the backend reports none', async () => {
    backend.acceptUploadAs(JOB_ID, {
      statuses: [{ job_id: JOB_ID, status: 'processing', created_at: PROCESSING_STATUS.created_at }],
    })
    const user = await renderApp()
    await chooseAndAnalyse(user)

    const panel = await jobPanel()
    await within(panel).findByText('Stage not reported')
    const bar = within(panel).getByRole('progressbar', { name: 'Analysis progress' })
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(panel).toHaveTextContent('—')
    expect(panel).not.toHaveTextContent(/\d+%/)
  })

  it('shows how much of the file has been sent while uploading', async () => {
    backend.holdUploads = true
    backend.acceptUploadAs(JOB_ID, { statuses: [QUEUED_STATUS] })
    const user = await renderApp()

    await chooseAndAnalyse(user)

    const bar = await screen.findByRole('progressbar', { name: 'Upload progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '50')

    await act(async () => backend.releaseUploads())
    const panel = await jobPanel()
    expect(await within(panel).findByText('Queued')).toBeInTheDocument()
  })

  it('never fills the live counters from an offline analysis job', async () => {
    backend.acceptUploadAs(JOB_ID, { statuses: [PROCESSING_STATUS] })
    const user = await renderApp()

    await chooseAndAnalyse(user)
    await within(await jobPanel()).findByText('Starting pipeline')

    for (const name of ['Blue fighter', 'Red fighter', 'Live metrics']) {
      expect(screen.getByRole('region', { name }).textContent).not.toMatch(/\d/)
    }
  })

  it("shows the backend's reason when it refuses the upload", async () => {
    backend.uploadReply = jsonReply(400, { detail: 'Uploaded video is empty.' })
    const user = await renderApp()

    await chooseAndAnalyse(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Upload failed: Uploaded video is empty.',
    )
    expect(screen.getByRole('button', { name: 'Analyse video' })).toBeEnabled()
  })

  it('says so when the backend cannot be reached', async () => {
    backend.online = false
    const user = await renderApp()

    expect(backendStatus()).toHaveTextContent('Backend unreachable')
    await chooseAndAnalyse(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /upload failed: cannot reach the mma vision backend/i,
    )
  })

  it('keeps checking through a lost connection and recovers', async () => {
    backend.acceptUploadAs(JOB_ID, { statuses: [PROXY_FAILURE, PROCESSING_STATUS] })
    const user = await renderApp()

    await chooseAndAnalyse(user)

    const panel = await jobPanel()
    expect(await within(panel).findByText(/connection problem/i)).toBeInTheDocument()
    expect(backendStatus()).toHaveTextContent('Backend unreachable')

    // The next check comes 2.5 s later and succeeds.
    await within(panel).findByText('Starting pipeline', {}, { timeout: 4000 })
    expect(within(panel).queryByText(/connection problem/i)).not.toBeInTheDocument()
  }, 10_000)

  it('reports a failed job with the error the backend recorded', async () => {
    backend.acceptUploadAs(JOB_ID, { statuses: [FAILED_STATUS] })
    const user = await renderApp()

    await chooseAndAnalyse(user)

    const panel = await jobPanel()
    expect(
      await within(panel).findByText('Pipeline exited with code 1. Check pipeline.log.'),
    ).toBeInTheDocument()
    expect(panel).toHaveTextContent(/analysis failed/i)
    expect(panel).toHaveTextContent('Stopped after 3 of 9 stages')

    await user.click(screen.getByRole('tab', { name: 'Match Ended' }))
    expect(screen.getByRole('note')).toHaveTextContent(/analysis failed/i)
    for (const name of ['Blue fighter final score', 'Red fighter final score']) {
      expect(screen.getByRole('region', { name }).textContent).not.toMatch(/\d/)
    }
  })

  it('keeps asking about a job opened from the address while the backend is down', async () => {
    backend.online = false
    await openJobFromAddress()

    const panel = await jobPanel()
    expect(await within(panel).findByText(/connection problem/i)).toBeInTheDocument()
    expect(panel).toHaveTextContent('Checking job')
    // Nothing was uploaded from this page, so the card must not say so.
    expect(panel).not.toHaveTextContent(/upload/i)
  })

  it('says it is checking, not analysing, until the backend reports the job', async () => {
    backend.online = false
    const user = await openJobFromAddress()
    await within(await jobPanel()).findByText(/connection problem/i)

    const statusBar = screen.getByRole('contentinfo')
    expect(statusBar).toHaveTextContent('Checking job')
    expect(statusBar).not.toHaveTextContent(/analysing/i)

    await user.click(screen.getByRole('tab', { name: 'Match Ended' }))
    expect(screen.getByRole('note')).toHaveTextContent('Checking job')
    expect(screen.getByRole('main').textContent).not.toMatch(/running|in progress/i)
  })

  it('explains a job the backend does not know', async () => {
    await openJobFromAddress('11111111-2222-4333-8444-555555555555')

    const panel = await jobPanel()
    expect(await within(panel).findByText(/no job with this ID/i)).toBeInTheDocument()
  })
})

describe('Match Ended with a completed job', () => {
  it('opens Match Ended with the real scorecard when the job completes', async () => {
    backend.acceptUploadAs(JOB_ID, completedJob())
    const user = await renderApp()

    await chooseAndAnalyse(user)

    expect(await screen.findByRole('tab', { name: 'Match Ended', selected: true })).toBeInTheDocument()
    const blue = screen.getByRole('region', { name: 'Blue fighter final score' })
    expect(await within(blue).findByText('8')).toBeInTheDocument()
    const red = screen.getByRole('region', { name: 'Red fighter final score' })
    expect(within(red).getByText('17')).toBeInTheDocument()

    const result = screen.getByRole('region', { name: 'Experimental activity result' })
    expect(result).toHaveTextContent('Higher Experimental Activity Score')
    expect(result).toHaveTextContent('Red Fighter')
    expect(result).toHaveTextContent(/not an official fight winner/i)
  })

  it('resumes a job from the address and compares the fighters with backend counts', async () => {
    backend.addJob(JOB_ID, completedJob())
    await openJobFromAddress()

    expect(await screen.findByRole('tab', { name: 'Match Ended', selected: true })).toBeInTheDocument()
    const table = screen.getByRole('region', { name: 'Final event comparison' })
    await within(table).findByText('15')

    expect(comparison('Total final events')).toEqual(['3', '8'])
    expect(comparison('Punch-like events')).toEqual(['3', '5'])
    expect(comparison('Kick-like events')).toEqual(['0', '3'])
    expect(comparison('Strong events')).toEqual(['1', '7'])
    expect(comparison('Very Strong events')).toEqual(['2', '1'])
    expect(comparison('Review events')).toEqual(['8', '7'])
    expect(comparison('Low events')).toEqual(['15', '14'])
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Final fight analysis')
    // The name the backend recorded, under the heading. (The replay panel names it too.)
    expect(heading.parentElement).toHaveTextContent(/mma cllip -1-highlight\.mp4/)
  })

  it('links every file the run wrote, through the proxy', async () => {
    backend.addJob(JOB_ID, completedJob())
    await openJobFromAddress()

    const files = await screen.findByRole('region', { name: 'Job files' })
    expect(within(files).getAllByRole('link')).toHaveLength(21)
    expect(
      within(files).getByRole('link', { name: 'Download final_strike_candidates.csv' }),
    ).toHaveAttribute('href', `/api/jobs/${JOB_ID}/files/results/final_strike_candidates.csv`)

    const reports = screen.getByRole('region', { name: 'Reports & artifacts' })
    expect(
      within(reports).getByRole('link', { name: 'Download experimental_scorecard_report.txt' }),
    ).toHaveAttribute('href', `/api/jobs/${JOB_ID}/files/results/experimental_scorecard_report.txt`)

    const video = screen.getByRole('region', { name: 'Processed video' })
    expect(within(video).getByRole('link', { name: 'Download movement_analysis.mp4' })).toHaveAttribute(
      'href',
      `/api/jobs/${JOB_ID}/files/videos/movement_analysis.mp4`,
    )
  })

  it("shows the backend's scorecard report as it wrote it", async () => {
    backend.addJob(JOB_ID, completedJob())
    await openJobFromAddress()

    const report = await screen.findByRole('region', { name: 'Scorecard report' })
    expect(report).toHaveTextContent('MMA VISION - EXPERIMENTAL SCORECARD')
    expect(report).toHaveTextContent('RED has the higher experimental strike activity score.')
  })

  it('says which files are missing instead of inventing their contents', async () => {
    const files = ARTIFACT_FILES.filter(
      ([path]) => path !== CLASSIFIED && path !== 'videos/movement_analysis.mp4',
    )
    backend.addJob(JOB_ID, completedJob({ artifacts: jsonReply(200, artifactsResponse(files)) }))
    await openJobFromAddress()

    const table = await screen.findByRole('region', { name: 'Final event comparison' })
    await within(table).findByText(/did not produce classified_strike_candidates\.csv/)
    expect(comparison('Review events')).toEqual(['—', '—'])
    expect(comparison('Low events')).toEqual(['—', '—'])
    expect(comparison('Strong events')).toEqual(['1', '7'])

    const video = screen.getByRole('region', { name: 'Processed video' })
    expect(within(video).getByText('Not produced')).toBeInTheDocument()
  })

  it('keeps the scorecard when the file list fails, and offers to retry', async () => {
    backend.addJob(JOB_ID, completedJob({ artifacts: textReply(500, 'Internal Server Error') }))
    await openJobFromAddress()

    const blue = await screen.findByRole('region', { name: 'Blue fighter final score' })
    expect(await within(blue).findByText('8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry loading results' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Reports & artifacts' })).toHaveTextContent(/HTTP 500/)
  })

  it('names nobody when the experimental scores are equal', async () => {
    const [blue] = RESULTS.scorecard
    const tie = { ...RESULTS, scorecard: [blue, { ...blue, fighter: 'Red' }] }
    backend.addJob(JOB_ID, completedJob({ results: jsonReply(200, tie) }))
    await openJobFromAddress()

    const result = await screen.findByRole('region', { name: 'Experimental activity result' })
    expect(await within(result).findByText('TIE — Equal Experimental Activity Scores')).toBeInTheDocument()
    expect(result.textContent).not.toMatch(/blue fighter|red fighter/i)
  })

  it('flags a score that does not follow the displayed scoring rules', async () => {
    const [blue, red] = RESULTS.scorecard
    const altered = { ...RESULTS, scorecard: [{ ...blue, activity_score: '9' }, red] }
    backend.addJob(JOB_ID, completedJob({ results: jsonReply(200, altered) }))
    await openJobFromAddress()

    expect(await screen.findByText(/does not match the scoring rules/)).toBeInTheDocument()
  })
})

describe('Match Ended: events, replay, movement and direction', () => {
  it('lists the scored events of the run in time order with their measurements', async () => {
    backend.addJob(JOB_ID, completedJob())
    await openJobFromAddress()
    await waitForEvents()

    const rows = eventRows()
    expect(rows).toHaveLength(11)
    // final_strike_report.txt: red 0.616667 punch-like right 80.47 Very Strong.
    expect(rows[0]).toEqual(['00:00.617', 'Red', 'Punch-like · right', 'Very Strong', '3', '0.91', '80.47'])
    expect(rows[2]).toEqual(['00:01.283', 'Blue', 'Punch-like · right', 'Very Strong', '3', '0.94', '96.33'])
    expect(rows[10]).toEqual(['00:11.600', 'Red', 'Kick-like · left', 'Strong', '2', '0.96', '76.80'])
  })

  it('names the span of the event strip in clock times, as the table does', async () => {
    backend.addJob(JOB_ID, completedJob())
    await openJobFromAddress()
    const table = await waitForEvents()

    // The strip runs to the last analysed frame, 899 / 60 fps = 14.98333… s.
    expect(
      within(table).getByRole('img', {
        name: 'Timeline of 11 events, 3 Blue and 8 Red, from 00:00.000 to 00:14.983.',
      }),
    ).toBeInTheDocument()
  })

  it('shows the Review and Low candidates too when asked, at zero points', async () => {
    backend.addJob(JOB_ID, completedJob())
    const user = await openJobFromAddress()
    const table = await waitForEvents()

    await user.click(within(table).getByRole('button', { name: 'All candidates (55)' }))

    const rows = eventRows()
    expect(rows).toHaveLength(55)
    // The first row of the file: blue right punch-like, peak 0.0833 s, Low.
    expect(rows[0]).toEqual(['00:00.083', 'Blue', 'Punch-like · right', 'Low', '0', '0.94', '44.46'])
    expect(within(table).getByRole('button', { name: 'Scored events (11)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it("shows the selected event's measurements, including its direction", async () => {
    backend.addJob(JOB_ID, completedJob())
    const user = await openJobFromAddress()
    const table = await waitForEvents()

    await user.click(within(table).getByRole('button', { name: /^00:01\.283 Blue/ }))

    const card = screen.getByRole('region', { name: 'Selected event' })
    for (const text of [
      'Blue',
      'Punch-like · right',
      'Very Strong · 3 points',
      '00:01.150',
      '00:01.483',
      '2,749 px/s',
      '96.33',
      '0.94',
      '−0.841',
      '−45.56 px',
      '12 of 12 frames',
    ]) {
      expect(card).toHaveTextContent(text)
    }
    expect(card).toHaveTextContent(/not a confirmed landed strike/)
  })

  it('steps to the next and previous event', async () => {
    backend.addJob(JOB_ID, completedJob())
    const user = await openJobFromAddress()
    const table = await waitForEvents()
    await user.click(within(table).getByRole('button', { name: /^00:01\.283 Blue/ }))
    const card = screen.getByRole('region', { name: 'Selected event' })

    await user.click(within(card).getByRole('button', { name: 'Next event' }))
    expect(card).toHaveTextContent('Peak 00:01.750')

    await user.click(within(card).getByRole('button', { name: 'Previous event' }))
    await user.click(within(card).getByRole('button', { name: 'Previous event' }))
    expect(card).toHaveTextContent('Peak 00:01.000')
  })

  it('replays the video uploaded from this page and jumps to the selected event', async () => {
    backend.acceptUploadAs(JOB_ID, completedJob())
    const user = await renderApp()
    await chooseAndAnalyse(user)
    await waitForEvents()

    const replay = screen.getByRole('region', { name: 'Replay' })
    await user.click(within(replay).getByRole('button', { name: 'Original video' }))
    const video = within(replay).getByLabelText('Replay of title-fight.mp4')
    expect(video).toHaveAttribute('src', 'blob:mma-vision-test')
    expect(replay).toHaveTextContent(/uploaded from this page/)
    const seeks = recordSeeks(video)

    await user.click(screen.getByRole('button', { name: /^00:01\.283 Blue/ }))

    // The event's start time, as the pipeline measured it.
    expect(seeks).toEqual([1.15])
  })

  it('asks for the original video when the job was not uploaded here, and checks its size', async () => {
    backend.addJob(JOB_ID, completedJob({ statuses: [{ ...COMPLETED_STATUS, file_size_bytes: 2048 }] }))
    const user = await openJobFromAddress()
    await waitForEvents()

    const replay = screen.getByRole('region', { name: 'Replay' })
    await user.click(within(replay).getByRole('button', { name: 'Original video' }))
    expect(replay).toHaveTextContent(/does not serve the uploaded video/)
    expect(within(replay).queryByLabelText(/^Replay of/)).not.toBeInTheDocument()

    const input = within(replay).getByLabelText('Choose the original video for replay')
    await user.upload(input, new File(['0'.repeat(100)], 'other.mp4', { type: 'video/mp4' }))
    expect(replay).toHaveTextContent(/100 bytes, but the analysed upload was 2,048 bytes/)
    expect(within(replay).queryByLabelText(/^Replay of/)).not.toBeInTheDocument()

    await user.upload(input, mp4('my-copy.mp4'))
    expect(within(replay).getByLabelText('Replay of my-copy.mp4')).toBeInTheDocument()
    expect(replay).toHaveTextContent(/same size as the analysed upload/)
  })

  it("charts the backend's movement data and quotes its movement report", async () => {
    backend.addJob(JOB_ID, completedJob())
    const user = await openJobFromAddress()
    await waitForEvents()

    const movement = screen.getByRole('region', { name: 'Movement over time' })
    expect(within(movement).getByRole('img', { name: /Fighter movement speed/ })).toBeInTheDocument()
    for (const text of ['151.73 px/s', '418.65 px/s', '163.22 px/s', '577.37 px/s']) {
      expect(movement).toHaveTextContent(text)
    }
    expect(within(movement).getByRole('link', { name: 'Download fighter_movement_speed.png' })).toBeInTheDocument()

    await user.click(within(movement).getByRole('button', { name: 'Distance' }))
    for (const text of ['402.80 px', '170.88 px', '712.90 px']) expect(movement).toHaveTextContent(text)

    await user.click(within(movement).getByRole('button', { name: 'Cumulative movement' }))
    for (const text of ['3,619.37 px', '4,593.67 px']) expect(movement).toHaveTextContent(text)

    const panel = screen.getByRole('region', { name: 'Movement analysis' })
    expect(panel).toHaveTextContent('3,619 px')
    expect(panel).toHaveTextContent('4,594 px')
  })

  it('reads the plotted values frame by frame with the keyboard', async () => {
    backend.addJob(JOB_ID, completedJob())
    const user = await openJobFromAddress()
    await waitForEvents()
    const movement = screen.getByRole('region', { name: 'Movement over time' })

    within(movement).getByRole('img', { name: /Fighter movement speed/ }).focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')

    // Frame 1 of movement_metrics_cleaned.csv: 15.0 and 34.635… px/s.
    const reading = within(movement).getByRole('status', { name: 'Chart reading' })
    expect(reading).toHaveTextContent('00:00.017')
    expect(reading).toHaveTextContent('Blue 15.0 px/s')
    expect(reading).toHaveTextContent('Red 34.6 px/s')
  })

  it("plots each event's direction and matches the backend's class averages", async () => {
    backend.addJob(JOB_ID, completedJob())
    const user = await openJobFromAddress()
    await waitForEvents()

    const direction = screen.getByRole('region', { name: 'Opponent direction by event' })
    // opponent_direction_report.txt: -0.339, 0.252, -0.060, -0.083.
    for (const text of ['−0.339', '+0.252', '−0.060', '−0.083']) expect(direction).toHaveTextContent(text)
    expect(within(direction).getAllByRole('button', { name: /^(Blue|Red) / })).toHaveLength(55)

    await user.click(within(direction).getByRole('button', { name: 'Approach change' }))
    for (const text of ['−80.96 px', '+7.42 px', '−19.87 px', '+3.02 px']) {
      expect(direction).toHaveTextContent(text)
    }

    await user.click(within(direction).getByRole('button', { name: /^Blue punch-like at 00:01\.283/ }))
    expect(screen.getByRole('region', { name: 'Selected event' })).toHaveTextContent('Peak 00:01.283')

    const panel = screen.getByRole('region', { name: 'Opponent direction' })
    expect(panel).toHaveTextContent('−0.339')
    expect(panel).toHaveTextContent('+0.252')
  })

  it('says which movement and direction files are missing, and keeps the rest', async () => {
    const files = ARTIFACT_FILES.filter(
      ([path]) =>
        path !== 'results/movement_metrics_cleaned.csv' &&
        path !== 'results/opponent_direction_analysis.csv',
    )
    backend.addJob(JOB_ID, completedJob({ artifacts: jsonReply(200, artifactsResponse(files)) }))
    const user = await openJobFromAddress()
    const table = await waitForEvents()

    const movement = screen.getByRole('region', { name: 'Movement over time' })
    expect(movement).toHaveTextContent('This job did not produce movement_metrics_cleaned.csv.')
    // The report is a separate file, so its figures are still there.
    expect(movement).toHaveTextContent('151.73 px/s')
    expect(screen.getByRole('region', { name: 'Opponent direction by event' })).toHaveTextContent(
      'This job did not produce opponent_direction_analysis.csv.',
    )

    await user.click(within(table).getByRole('button', { name: /^00:01\.283 Blue/ }))
    expect(screen.getByRole('region', { name: 'Selected event' })).toHaveTextContent(
      /Direction unavailable: This job did not produce opponent_direction_analysis\.csv\./,
    )
  })

  it("plays the backend's annotated video by default and jumps it to the selected event", async () => {
    backend.addJob(JOB_ID, completedJob())
    const user = await openJobFromAddress()
    await waitForEvents()

    const replay = screen.getByRole('region', { name: 'Replay' })
    expect(within(replay).getByRole('button', { name: 'Annotated video' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const video = within(replay).getByLabelText('Annotated replay of movement_analysis.mp4')
    expect(video).toHaveAttribute('src', `/api/jobs/${JOB_ID}/video`)
    // The backend converts it the first time; until the browser has its
    // length, the panel says what it is waiting for.
    expect(replay).toHaveTextContent(/Preparing the annotated video/)

    const seeks = recordSeeks(video)
    fireEvent.loadedMetadata(video)
    expect(replay).not.toHaveTextContent(/Preparing the annotated video/)
    expect(replay).toHaveTextContent(/H\.264 copy of movement_analysis\.mp4/)

    await user.click(screen.getByRole('button', { name: /^00:01\.283 Blue/ }))
    // The same frames and times as the analysed video, so the same start time.
    expect(seeks).toEqual([1.15])
  })

  it('keeps the selected event when switching between the annotated and original video', async () => {
    backend.acceptUploadAs(JOB_ID, completedJob())
    const user = await renderApp()
    await chooseAndAnalyse(user)
    await waitForEvents()
    await user.click(screen.getByRole('button', { name: /^00:01\.283 Blue/ }))

    const replay = screen.getByRole('region', { name: 'Replay' })
    await user.click(within(replay).getByRole('button', { name: 'Original video' }))
    const original = within(replay).getByLabelText('Replay of title-fight.mp4')
    const originalSeeks = recordSeeks(original)
    fireEvent.loadedMetadata(original)
    expect(originalSeeks).toEqual([1.15])

    await user.click(within(replay).getByRole('button', { name: 'Annotated video' }))
    const annotated = within(replay).getByLabelText('Annotated replay of movement_analysis.mp4')
    const annotatedSeeks = recordSeeks(annotated)
    fireEvent.loadedMetadata(annotated)
    expect(annotatedSeeks).toEqual([1.15])
  })

  it('detaches the original video from its file before releasing it', async () => {
    backend.acceptUploadAs(JOB_ID, completedJob())
    const user = await renderApp()
    await chooseAndAnalyse(user)
    await waitForEvents()
    const replay = screen.getByRole('region', { name: 'Replay' })
    await user.click(within(replay).getByRole('button', { name: 'Original video' }))
    const original = within(replay).getByLabelText('Replay of title-fight.mp4')

    // A <video> still pointing at a released blob: URL keeps asking for it,
    // and the browser logs every failed request.
    const srcWhenReleased: Array<string | null> = []
    URL.revokeObjectURL = () => {
      srcWhenReleased.push(original.getAttribute('src'))
    }
    await user.click(within(replay).getByRole('button', { name: 'Annotated video' }))

    expect(srcWhenReleased).toEqual([null])
  })

  it("gives the backend's reason when the annotated video cannot be prepared", async () => {
    const reason = 'No ffmpeg was found to make a browser-playable copy. Install ffmpeg or set MMA_FFMPEG to its path.'
    backend.addJob(JOB_ID, completedJob({ video: jsonReply(503, { detail: reason }) }))
    const user = await openJobFromAddress()
    await waitForEvents()

    const replay = screen.getByRole('region', { name: 'Replay' })
    fireEvent.error(within(replay).getByLabelText('Annotated replay of movement_analysis.mp4'))

    expect(await within(replay).findByRole('alert')).toHaveTextContent(
      `The backend could not prepare the annotated video: ${reason}`,
    )
    expect(replay).not.toHaveTextContent(/Preparing the annotated video/)
    // Only the first byte is asked for, to read the reason.
    expect(backend.requests).toContain(`GET /api/jobs/${JOB_ID}/video [Range: bytes=0-0]`)
    // The original video is still offered.
    await user.click(within(replay).getByRole('button', { name: 'Original video' }))
    expect(within(replay).getByLabelText('Choose the original video for replay')).toBeInTheDocument()
  })

  it('says so when the backend served the annotated video but the browser cannot play it', async () => {
    backend.addJob(JOB_ID, completedJob())
    await openJobFromAddress()
    await waitForEvents()

    const replay = screen.getByRole('region', { name: 'Replay' })
    fireEvent.error(within(replay).getByLabelText('Annotated replay of movement_analysis.mp4'))

    expect(await within(replay).findByRole('alert')).toHaveTextContent(
      /This browser could not play the annotated video/,
    )
  })

  it('offers only the original video when the run wrote no processed video', async () => {
    const withoutVideo = ARTIFACTS.artifacts.filter(
      (artifact) => artifact.filename !== 'videos/movement_analysis.mp4',
    )
    backend.addJob(
      JOB_ID,
      completedJob({ artifacts: jsonReply(200, { ...ARTIFACTS, artifacts: withoutVideo }) }),
    )
    await openJobFromAddress()
    await waitForEvents()

    const replay = screen.getByRole('region', { name: 'Replay' })
    expect(replay).toHaveTextContent(/did not produce movement_analysis\.mp4/)
    expect(within(replay).queryByRole('button', { name: 'Annotated video' })).not.toBeInTheDocument()
    expect(within(replay).getByLabelText('Choose the original video for replay')).toBeInTheDocument()
  })

  it('keeps the mp4v processed video a download and never plays it in the page', async () => {
    backend.acceptUploadAs(JOB_ID, completedJob())
    const user = await renderApp()
    await chooseAndAnalyse(user)
    await waitForEvents()

    const panel = screen.getByRole('region', { name: 'Processed video' })
    expect(within(panel).getByRole('link', { name: 'Download movement_analysis.mp4' })).toBeInTheDocument()
    expect(panel).toHaveTextContent(/mp4v/)
    const sources = [...document.querySelectorAll('video')].map((video) => video.getAttribute('src'))
    expect(sources.some((src) => src?.includes('movement_analysis.mp4'))).toBe(false)
  })
})
