import type { AnalysisData, Artifact, Classification, Part } from '../types/api'
import { getArtifactText, getJobArtifacts, getJobResults } from './api'
import { ARTIFACT_PATHS, findArtifact } from './artifactPaths'
import { ApiError, messageOf } from './http'
import { countClassifications } from './normalize'

/**
 * Everything Match Ended shows for a completed job: the scorecard and its
 * report, the list of files the run wrote, and the class counts from the
 * classification CSV. Each part succeeds or fails on its own, so one missing
 * file costs only the panel that needs it.
 */
export async function loadAnalysis(jobId: string, signal: AbortSignal): Promise<AnalysisData> {
  const [results, artifacts] = await Promise.all([
    settle(() => getJobResults(jobId, signal), signal),
    settle(() => getJobArtifacts(jobId, signal), signal),
  ])
  const classification = await loadClassification(artifacts, signal)
  return { results, artifacts, classification }
}

async function settle<T>(load: () => Promise<T>, signal: AbortSignal): Promise<Part<T>> {
  try {
    return { state: 'ready', data: await load() }
  } catch (error) {
    if (signal.aborted) throw error
    // A 404 is the backend saying the file does not exist, not that something broke.
    if (error instanceof ApiError && error.status === 404) {
      return { state: 'missing', message: error.message }
    }
    return { state: 'error', message: messageOf(error) }
  }
}

async function loadClassification(
  artifacts: Part<Artifact[]>,
  signal: AbortSignal,
): Promise<Part<Classification>> {
  if (artifacts.state !== 'ready') {
    return {
      state: 'error',
      message: 'The file list could not be loaded, so the classification file could not be found.',
    }
  }
  const file = findArtifact(artifacts.data, ARTIFACT_PATHS.classifiedEvents)
  if (!file) {
    return { state: 'missing', message: 'This job did not produce classified_strike_candidates.csv.' }
  }
  return settle(async () => countClassifications(await getArtifactText(file.href, signal)), signal)
}
