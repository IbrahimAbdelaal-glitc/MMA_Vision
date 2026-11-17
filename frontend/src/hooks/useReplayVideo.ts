import { useCallback, useState } from 'react'
import { checkReplayFile } from '../utils/replayFile'
import type { JobState } from './useAnalysisJob'

/*
 * The video the Match Ended replay plays, and only ever a file on this
 * computer. The API serves a job's results and its processed video, not the
 * uploaded original, and the processed video is mp4v, which Chrome, Edge and
 * Firefox cannot decode. So the replay plays the original footage from the
 * user's own copy: the file uploaded from this page, or, for a job opened
 * from its address, a copy the user chooses again.
 */

export interface ReplaySource {
  /** Changes whenever the file does, so the player starts afresh. */
  key: string
  file: File
  /** uploaded: the file sent to the backend from this page. chosen: a copy picked for the replay. */
  origin: 'uploaded' | 'chosen'
  /** How a chosen copy was checked against the upload; null for the uploaded file itself. */
  match: 'same-size' | 'unchecked' | null
}

export interface ReplayVideo {
  source: ReplaySource | null
  /** Why the last file chosen for the replay was refused. */
  refusal: string | null
  /** The analysed upload, as the backend recorded it. */
  upload: { name: string | null; sizeBytes: number | null }
  /** A copy can be chosen: the job was not uploaded from this page. */
  canChoose: boolean
  choose: (file: File) => void
}

interface ChosenCopy {
  jobId: string
  file: File
  match: 'same-size' | 'unchecked'
  /** Counts the choices, so choosing again always gives a new key. */
  serial: number
}

export function useReplayVideo(job: JobState): ReplayVideo {
  const [chosen, setChosen] = useState<ChosenCopy | null>(null)
  const [refusal, setRefusal] = useState<{ jobId: string; message: string } | null>(null)

  const { jobId } = job
  const uploadBytes = job.status?.fileSizeBytes ?? null
  // A choice belongs to the job it was made for; opening another job forgets it.
  const copy = chosen !== null && chosen.jobId === jobId ? chosen : null

  const choose = useCallback(
    (candidate: File) => {
      if (!jobId) return
      const check = checkReplayFile(candidate, uploadBytes)
      if (!check.ok) {
        // Keep the copy already playing, if any; only say why this one was refused.
        setRefusal({ jobId, message: check.message })
        return
      }
      setRefusal(null)
      setChosen((previous) => ({
        jobId,
        file: candidate,
        match: check.match,
        serial: (previous?.serial ?? 0) + 1,
      }))
    },
    [jobId, uploadBytes],
  )

  let source: ReplaySource | null = null
  if (job.file) {
    source = { key: `uploaded-${jobId ?? 'pending'}`, file: job.file, origin: 'uploaded', match: null }
  } else if (copy) {
    source = { key: `chosen-${copy.serial}`, file: copy.file, origin: 'chosen', match: copy.match }
  }

  return {
    source,
    refusal: refusal !== null && refusal.jobId === jobId ? refusal.message : null,
    upload: { name: job.status?.originalFilename ?? null, sizeBytes: uploadBytes },
    canChoose: jobId !== null && job.file === null,
    choose,
  }
}
