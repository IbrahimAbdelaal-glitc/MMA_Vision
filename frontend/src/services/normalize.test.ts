import { describe, expect, it } from 'vitest'
import {
  ARTIFACTS,
  classifiedCsv,
  COMPLETED_STATUS,
  JOB_ID,
  RESULTS,
} from '../test/fixtures/realJob'
import { ApiError } from './http'
import {
  classificationContradictsScorecard,
  countClassifications,
  normalizeArtifacts,
  normalizeJobStatus,
  normalizeScorecard,
} from './normalize'

describe('normalizeJobStatus', () => {
  it('keeps every field of a real status.json', () => {
    expect(normalizeJobStatus(COMPLETED_STATUS)).toEqual({
      jobId: JOB_ID,
      status: 'completed',
      originalFilename: 'mma cllip -1-highlight.mp4',
      fileSizeBytes: 15230609,
      progress: 100,
      stagesCompleted: 9,
      totalStages: 9,
      currentStage: 'Completed',
      error: null,
      createdAt: '2026-11-15T20:11:14.449222+00:00',
      updatedAt: '2026-11-15T20:14:48.219733+00:00',
    })
  })

  it('refuses a status the backend does not define', () => {
    expect(() => normalizeJobStatus({ ...COMPLETED_STATUS, status: 'paused' })).toThrow(ApiError)
  })

  it('refuses an answer without a usable job ID', () => {
    expect(() => normalizeJobStatus({ ...COMPLETED_STATUS, job_id: '../secrets' })).toThrow(ApiError)
  })

  it('leaves an unreadable progress value empty instead of inventing one', () => {
    expect(normalizeJobStatus({ ...COMPLETED_STATUS, progress: 'abc' }).progress).toBeNull()
    expect(normalizeJobStatus({ ...COMPLETED_STATUS, progress: 140 }).progress).toBeNull()
  })
})

describe('normalizeScorecard', () => {
  it('converts the real scorecard strings into numbers', () => {
    expect(normalizeScorecard(RESULTS.scorecard)).toEqual({
      blue: { totalEvents: 3, punchLike: 3, kickLike: 0, strong: 1, veryStrong: 2, activityScore: 8 },
      red: { totalEvents: 8, punchLike: 5, kickLike: 3, strong: 7, veryStrong: 1, activityScore: 17 },
      issues: [],
    })
  })

  it('shows an unreadable value as missing and says which one', () => {
    const [blue, red] = RESULTS.scorecard
    const scorecard = normalizeScorecard([{ ...blue, activity_score: 'abc' }, red])

    expect(scorecard.blue?.activityScore).toBeNull()
    expect(scorecard.issues).toEqual([expect.stringMatching(/Blue activity_score/)])
  })

  it('notes a fighter the scorecard has no row for', () => {
    const scorecard = normalizeScorecard([RESULTS.scorecard[0]])

    expect(scorecard.red).toBeNull()
    expect(scorecard.issues).toEqual([expect.stringMatching(/no row for the Red fighter/)])
  })

  it('flags a score that does not follow the scoring rules', () => {
    const [blue, red] = RESULTS.scorecard
    const scorecard = normalizeScorecard([{ ...blue, activity_score: '9' }, red])

    expect(scorecard.blue?.activityScore).toBe(9)
    expect(scorecard.issues).toEqual([expect.stringMatching(/does not match the scoring rules/)])
  })
})

describe('normalizeArtifacts', () => {
  it('sends every download link through the proxy', () => {
    const artifacts = normalizeArtifacts(ARTIFACTS)

    expect(artifacts).toHaveLength(21)
    for (const artifact of artifacts) {
      expect(artifact.href).toBe(`/api/jobs/${JOB_ID}/files/${artifact.path}`)
    }
  })

  it('groups reports, tables, charts and video, each in name order', () => {
    const kinds = normalizeArtifacts(ARTIFACTS).map((artifact) => artifact.kind)

    expect(kinds.filter((kind) => kind === 'report')).toHaveLength(6)
    expect(kinds.filter((kind) => kind === 'table')).toHaveLength(10)
    expect(kinds.filter((kind) => kind === 'chart')).toHaveLength(4)
    expect(kinds.filter((kind) => kind === 'video')).toHaveLength(1)
    expect(kinds).toEqual([...kinds].sort(byKindOrder))
  })

  it('skips an entry whose download link is not a backend job path', () => {
    const artifacts = normalizeArtifacts({
      artifacts: [
        { filename: 'results/a.csv', size_bytes: 1, download_url: 'https://elsewhere.test/a.csv' },
        { filename: 'results/b.csv', size_bytes: 2, download_url: `/jobs/${JOB_ID}/files/results/b.csv` },
      ],
    })

    expect(artifacts.map((artifact) => artifact.name)).toEqual(['b.csv'])
  })

  it('refuses an answer without an artifact list', () => {
    expect(() => normalizeArtifacts({ job_id: JOB_ID })).toThrow(ApiError)
  })
})

describe('countClassifications', () => {
  it('counts each class for each fighter in the real classification file', () => {
    expect(countClassifications(classifiedCsv)).toEqual({
      blue: { 'Very Strong': 2, Strong: 1, Review: 8, Low: 15 },
      red: { 'Very Strong': 1, Strong: 7, Review: 7, Low: 14 },
      unrecognisedRows: 0,
    })
  })

  it('refuses a file without the columns it needs', () => {
    expect(() => countClassifications('a,b\r\n1,2\r\n')).toThrow(/fighter/)
  })

  it('counts rows it cannot place instead of guessing', () => {
    const counts = countClassifications(
      'fighter,detection_class\r\nblue,Strong\r\ngreen,Strong\r\nred,Maybe\r\n',
    )

    expect(counts.blue.Strong).toBe(1)
    expect(counts.unrecognisedRows).toBe(2)
  })

  it('agrees with the real scorecard on the scored classes', () => {
    const classification = countClassifications(classifiedCsv)
    const scorecard = normalizeScorecard(RESULTS.scorecard)

    expect(classificationContradictsScorecard(classification, scorecard)).toBe(false)
  })

  it('notices a classification file from a different run than the scorecard', () => {
    const classification = countClassifications(classifiedCsv)
    const [blue, red] = RESULTS.scorecard
    const other = normalizeScorecard([{ ...blue, strong_events: '4', activity_score: '14' }, red])

    expect(classificationContradictsScorecard(classification, other)).toBe(true)
  })
})

const KIND_ORDER = ['report', 'table', 'chart', 'video', 'other']
function byKindOrder(a: string, b: string): number {
  return KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b)
}
