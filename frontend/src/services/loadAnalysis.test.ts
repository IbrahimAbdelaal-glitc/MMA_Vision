import { beforeEach, describe, expect, it } from 'vitest'
import { FakeBackend, jsonReply, textReply, type FakeJob } from '../test/fakeBackend'
import {
  ARTIFACT_FILES,
  ARTIFACTS,
  artifactsResponse,
  COMPLETED_STATUS,
  JOB_ID,
  RESULT_FILES,
  RESULTS,
} from '../test/fixtures/realJob'
import { loadAnalysis } from './loadAnalysis'

const CLASSIFIED = 'results/classified_strike_candidates.csv'
const DIRECTION = 'results/opponent_direction_analysis.csv'
const MOVEMENT = 'results/movement_metrics_cleaned.csv'
const MOVEMENT_REPORT = 'results/movement_report.txt'

let backend: FakeBackend

beforeEach(() => {
  backend = new FakeBackend().install()
})

/** Every result file the dashboard reads, served as the real run wrote it. */
function realFiles() {
  return Object.fromEntries(
    Object.entries(RESULT_FILES).map(([path, text]) => [path, textReply(200, text)]),
  )
}

/** The real completed job, with any part replaced. */
function completedJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    statuses: [COMPLETED_STATUS],
    results: jsonReply(200, RESULTS),
    artifacts: jsonReply(200, ARTIFACTS),
    files: realFiles(),
    ...overrides,
  }
}

function withoutFile(path: string) {
  return jsonReply(200, artifactsResponse(ARTIFACT_FILES.filter(([file]) => file !== path)))
}

const load = () => loadAnalysis(JOB_ID, new AbortController().signal)

describe('loadAnalysis', () => {
  it('loads the scorecard, the file list and the class counts of a completed job', async () => {
    backend.addJob(JOB_ID, completedJob())

    const data = await load()

    expect(data.results).toMatchObject({
      state: 'ready',
      data: { scorecard: { blue: { activityScore: 8 }, red: { activityScore: 17 }, issues: [] } },
    })
    expect(data.artifacts.state === 'ready' && data.artifacts.data).toHaveLength(21)
    expect(data.classification).toEqual({
      state: 'ready',
      data: {
        blue: { 'Very Strong': 2, Strong: 1, Review: 8, Low: 15 },
        red: { 'Very Strong': 1, Strong: 7, Review: 7, Low: 14 },
        unrecognisedRows: 0,
      },
    })
    expect(backend.requests).toContain(`GET /api/jobs/${JOB_ID}/files/${CLASSIFIED}`)
  })

  it('loads the events, their direction and the movement data of the run', async () => {
    backend.addJob(JOB_ID, completedJob())

    const data = await load()

    expect(data.events.state === 'ready' && data.events.data.events).toHaveLength(55)
    expect(data.direction.state === 'ready' && data.direction.data.rows).toHaveLength(55)
    expect(data.movement.state === 'ready' && data.movement.data.time).toHaveLength(900)
    expect(data.movementReport).toMatchObject({ state: 'ready', data: { frames: 900 } })
    for (const path of [DIRECTION, MOVEMENT, MOVEMENT_REPORT]) {
      expect(backend.requests).toContain(`GET /api/jobs/${JOB_ID}/files/${path}`)
    }
  })

  it('downloads the classification file once for both the counts and the events', async () => {
    backend.addJob(JOB_ID, completedJob())

    await load()

    const downloads = backend.requests.filter((request) => request.endsWith(CLASSIFIED))
    expect(downloads).toHaveLength(1)
  })

  it('marks the class counts missing when the run wrote no classification file', async () => {
    backend.addJob(JOB_ID, completedJob({ artifacts: withoutFile(CLASSIFIED) }))

    const data = await load()

    expect(data.classification).toEqual({
      state: 'missing',
      message: expect.stringMatching(/classified_strike_candidates\.csv/),
    })
    expect(data.events).toEqual(data.classification)
    expect(data.results.state).toBe('ready')
  })

  it('names each Phase 3 file the run did not write, and loads the rest', async () => {
    backend.addJob(JOB_ID, completedJob({ artifacts: withoutFile(MOVEMENT) }))

    const data = await load()

    expect(data.movement).toEqual({
      state: 'missing',
      message: 'This job did not produce movement_metrics_cleaned.csv.',
    })
    expect(data.movementReport.state).toBe('ready')
    expect(data.direction.state).toBe('ready')
  })

  it('reports a movement file that cannot be downloaded', async () => {
    backend.addJob(
      JOB_ID,
      completedJob({ files: { ...realFiles(), [MOVEMENT]: textReply(500, '') } }),
    )

    const data = await load()

    expect(data.movement).toEqual({ state: 'error', message: expect.stringMatching(/HTTP 500/) })
    expect(data.events.state).toBe('ready')
  })

  it('reports a missing scorecard without losing the file list', async () => {
    backend.addJob(JOB_ID, completedJob({ results: jsonReply(404, { detail: 'Scorecard not found.' }) }))

    const data = await load()

    expect(data.results).toEqual({ state: 'missing', message: 'Scorecard not found.' })
    expect(data.artifacts.state).toBe('ready')
    expect(data.classification.state).toBe('ready')
  })

  it('keeps a failed file list from hiding the scorecard', async () => {
    backend.addJob(JOB_ID, completedJob({ artifacts: textReply(500, 'Internal Server Error') }))

    const data = await load()

    expect(data.results.state).toBe('ready')
    expect(data.artifacts).toEqual({ state: 'error', message: expect.stringMatching(/HTTP 500/) })
    expect(data.classification).toEqual({ state: 'error', message: expect.stringMatching(/file list/) })
    expect(data.movement).toEqual({ state: 'error', message: expect.stringMatching(/file list/) })
  })

  it('reports a classification file that cannot be downloaded', async () => {
    backend.addJob(
      JOB_ID,
      completedJob({ files: { ...realFiles(), [CLASSIFIED]: textReply(500, '') } }),
    )

    const data = await load()

    expect(data.classification).toEqual({ state: 'error', message: expect.stringMatching(/HTTP 500/) })
    expect(data.events).toEqual(data.classification)
  })
})
