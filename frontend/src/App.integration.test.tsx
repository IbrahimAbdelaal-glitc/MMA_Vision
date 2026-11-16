import { act, render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { FakeBackend, jsonReply, PROXY_FAILURE, textReply, type FakeJob } from './test/fakeBackend'
import {
  ARTIFACT_FILES,
  ARTIFACTS,
  artifactsResponse,
  classifiedCsv,
  COMPLETED_STATUS,
  FAILED_STATUS,
  JOB_ID,
  PROCESSING_STATUS,
  QUEUED_STATUS,
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
    files: { [CLASSIFIED]: textReply(200, classifiedCsv) },
    ...overrides,
  }
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Final fight analysis')
    expect(screen.getByText(/mma cllip -1-highlight\.mp4/)).toBeInTheDocument()
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
