import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeBackend, jsonReply, textReply } from '../test/fakeBackend'
import {
  ARTIFACTS,
  JOB_ID,
  PROCESSING_STATUS,
  QUEUED_STATUS,
  RESULTS,
} from '../test/fixtures/realJob'
import {
  getArtifactText,
  getHealth,
  getJobArtifacts,
  getJobResults,
  getJobStatus,
  uploadVideo,
} from './api'
import { ApiError } from './http'

const UNKNOWN_JOB = '11111111-2222-4333-8444-555555555555'

let backend: FakeBackend

beforeEach(() => {
  backend = new FakeBackend().install()
})

describe('reading a job from the backend', () => {
  it('asks the proxy for the status and turns its values into numbers', async () => {
    backend.addJob(JOB_ID, { statuses: [PROCESSING_STATUS] })

    const status = await getJobStatus(JOB_ID)

    expect(backend.requests).toEqual([`GET /api/jobs/${JOB_ID}`])
    expect(status).toMatchObject({
      jobId: JOB_ID,
      status: 'processing',
      progress: 0,
      stagesCompleted: 0,
      totalStages: 9,
      currentStage: 'Starting pipeline',
      originalFilename: 'mma cllip -1-highlight.mp4',
      fileSizeBytes: 15230609,
      error: null,
    })
  })

  it("passes on the backend's own reason for an error", async () => {
    const error = await getJobStatus(UNKNOWN_JOB).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'http', status: 404, message: 'Job not found.' })
  })

  it('says the backend is unreachable when the proxy cannot connect to it', async () => {
    backend.online = false

    await expect(getJobStatus(JOB_ID)).rejects.toMatchObject({
      kind: 'unreachable',
      message: expect.stringMatching(/cannot reach the mma vision backend/i),
    })
  })

  it('says the backend is unreachable when the request cannot be sent at all', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

    await expect(getJobStatus(JOB_ID)).rejects.toMatchObject({ kind: 'unreachable' })
  })

  it('refuses an answer that is not JSON', async () => {
    backend.addJob(JOB_ID, { statuses: [textReply(200, 'OK, not JSON')] })

    await expect(getJobStatus(JOB_ID)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it("reports FastAPI's validation messages", async () => {
    backend.addJob(JOB_ID, {
      statuses: [
        jsonReply(422, {
          detail: [{ type: 'missing', loc: ['body', 'file'], msg: 'Field required', input: null }],
        }),
      ],
    })

    await expect(getJobStatus(JOB_ID)).rejects.toMatchObject({
      kind: 'http',
      status: 422,
      message: 'Field required',
    })
  })

  it('names the HTTP status when the backend gives no reason', async () => {
    backend.addJob(JOB_ID, { statuses: [textReply(500, 'Internal Server Error')] })

    await expect(getJobStatus(JOB_ID)).rejects.toMatchObject({
      kind: 'http',
      status: 500,
      message: expect.stringMatching(/HTTP 500/),
    })
  })

  it('reads the completed results with numbers instead of strings', async () => {
    backend.addJob(JOB_ID, { statuses: [{}], results: jsonReply(200, RESULTS) })

    const results = await getJobResults(JOB_ID)

    expect(results.scorecard.blue?.activityScore).toBe(8)
    expect(results.scorecard.red?.activityScore).toBe(17)
    expect(results.report).toContain('EXPERIMENTAL SCORECARD')
  })

  it('gives every artifact a download link that goes through the proxy', async () => {
    backend.addJob(JOB_ID, { statuses: [{}], artifacts: jsonReply(200, ARTIFACTS) })

    const artifacts = await getJobArtifacts(JOB_ID)

    expect(artifacts).toHaveLength(21)
    expect(artifacts.find((artifact) => artifact.name === 'final_strike_candidates.csv')).toEqual({
      path: 'results/final_strike_candidates.csv',
      name: 'final_strike_candidates.csv',
      sizeBytes: 3756,
      href: `/api/jobs/${JOB_ID}/files/results/final_strike_candidates.csv`,
      kind: 'table',
    })
  })

  it('downloads the text of an artifact', async () => {
    backend.addJob(JOB_ID, {
      statuses: [{}],
      files: { 'results/movement_report.txt': textReply(200, 'MOVEMENT REPORT\r\n') },
    })

    const text = await getArtifactText(`/api/jobs/${JOB_ID}/files/results/movement_report.txt`)

    expect(text).toBe('MOVEMENT REPORT\r\n')
  })

  it('checks that the backend is running', async () => {
    await expect(getHealth()).resolves.toEqual({ version: '1.0.0' })
  })
})

describe('uploading a video', () => {
  const video = () => new File(['0'.repeat(4096)], 'title-fight.mp4', { type: 'video/mp4' })

  it('posts the file as FormData field "file" and leaves Content-Type to the browser', async () => {
    backend.acceptUploadAs(JOB_ID, { statuses: [QUEUED_STATUS] })

    const { jobId } = await uploadVideo(video())

    expect(jobId).toBe(JOB_ID)
    expect(backend.uploads).toHaveLength(1)
    const [upload] = backend.uploads
    expect(upload).toMatchObject({ method: 'POST', url: '/api/jobs', fields: ['file'] })
    expect(upload.file?.name).toBe('title-fight.mp4')
    expect(upload.file?.size).toBe(4096)
    expect(upload.headers).not.toHaveProperty('content-type')
  })

  it('reports how much of the file has been sent', async () => {
    const progress: Array<[number, number]> = []

    await uploadVideo(video(), { onProgress: (loaded, total) => progress.push([loaded, total]) })

    expect(progress.at(-1)).toEqual([4096, 4096])
  })

  it("passes on the backend's reason when it refuses the upload", async () => {
    backend.uploadReply = jsonReply(413, { detail: 'Video exceeds the 500 MB upload limit.' })

    await expect(uploadVideo(video())).rejects.toMatchObject({
      kind: 'http',
      status: 413,
      message: 'Video exceeds the 500 MB upload limit.',
    })
  })

  it('says the backend is unreachable when the upload cannot be sent', async () => {
    backend.uploadReply = 'network-error'

    await expect(uploadVideo(video())).rejects.toMatchObject({ kind: 'unreachable' })
  })

  it('says the backend is unreachable when the proxy cannot connect to it', async () => {
    backend.online = false

    await expect(uploadVideo(video())).rejects.toMatchObject({ kind: 'unreachable' })
  })
})
