import { describe, expect, it } from 'vitest'
import type { JobState } from '../../hooks/useAnalysisJob'
import { statusBarText } from './dashboardStatus'

const completedJob = {
  upload: null,
  uploadError: null,
  jobId: '3c7b357e-74b5-4cb7-a2ad-d610ad828f06',
  file: null,
  status: { status: 'completed' },
  connectionError: null,
  trackingError: null,
  analysis: { state: 'idle' },
  analysisAttempt: 0,
} as unknown as JobState

describe('statusBarText with a live session', () => {
  it('does not claim the live engine is disconnected while it runs', () => {
    const text = statusBarText('live', completedJob, 'job', 'live')
    expect(text.label).toBe('Live analysis')
    expect(text.message).toMatch(/provisional/i)
    expect(text.message).not.toMatch(/not connected/)
  })

  it('names each live phase', () => {
    expect(statusBarText('live', completedJob, 'job', 'uploading').label).toBe('Live: uploading')
    expect(statusBarText('live', completedJob, 'job', 'starting').label).toBe('Live: starting')
    expect(statusBarText('live', completedJob, 'job', 'ended').message).toMatch(/Analyse offline/)
  })

  it('keeps the job wording when no live session exists, and on Match Ended', () => {
    expect(statusBarText('live', completedJob, 'job', 'idle').label).toBe('Analysis complete')
    expect(statusBarText('ended', completedJob, 'job', 'live').label).toBe('Post-fight results')
  })
})
