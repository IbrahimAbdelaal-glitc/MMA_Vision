import { beforeEach, describe, expect, it } from 'vitest'
import { FakeBackend, jsonReply, textReply, type FakeJob } from '../test/fakeBackend'
import {
  ARTIFACT_FILES,
  ARTIFACTS,
  artifactsResponse,
  classifiedCsv,
  COMPLETED_STATUS,
  JOB_ID,
  RESULTS,
} from '../test/fixtures/realJob'
import { loadAnalysis } from './loadAnalysis'

const CLASSIFIED = 'results/classified_strike_candidates.csv'

let backend: FakeBackend

beforeEach(() => {
  backend = new FakeBackend().install()
})

/** The real completed job, with any part replaced. */
function completedJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    statuses: [COMPLETED_STATUS],
    results: jsonReply(200, RESULTS),
    artifacts: jsonReply(200, ARTIFACTS),
    files: { [CLASSIFIED]: textReply(200, classifiedCsv) },
    ...overrides,
  }
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

  it('marks the class counts missing when the run wrote no classification file', async () => {
    const withoutClassified = ARTIFACT_FILES.filter(([path]) => path !== CLASSIFIED)
    backend.addJob(JOB_ID, completedJob({ artifacts: jsonReply(200, artifactsResponse(withoutClassified)) }))

    const data = await load()

    expect(data.classification).toEqual({
      state: 'missing',
      message: expect.stringMatching(/classified_strike_candidates\.csv/),
    })
    expect(data.results.state).toBe('ready')
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
  })

  it('reports a classification file that cannot be downloaded', async () => {
    backend.addJob(JOB_ID, completedJob({ files: { [CLASSIFIED]: textReply(500, '') } }))

    const data = await load()

    expect(data.classification).toEqual({ state: 'error', message: expect.stringMatching(/HTTP 500/) })
  })
})
