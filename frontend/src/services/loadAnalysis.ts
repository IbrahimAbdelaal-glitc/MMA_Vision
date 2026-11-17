import type { AnalysisData, Artifact, Part } from '../types/api'
import { getArtifactText, getJobArtifacts, getJobResults } from './api'
import { ARTIFACT_PATHS, fileNameOf, findArtifact } from './artifactPaths'
import { readCandidateEvents, readDirection } from './events'
import { ApiError, messageOf } from './http'
import { readMovementReport, readMovementSeries } from './movement'
import { countClassifications } from './normalize'

/**
 * Everything Match Ended shows for a completed job: the scorecard and its
 * report, the list of files the run wrote, and the result files the panels
 * read (events, direction, movement). Each part succeeds or fails on its own,
 * so one missing or unreadable file costs only the panel that needs it.
 */
export async function loadAnalysis(jobId: string, signal: AbortSignal): Promise<AnalysisData> {
  const [results, artifacts] = await Promise.all([
    settle(() => getJobResults(jobId, signal), signal),
    settle(() => getJobArtifacts(jobId, signal), signal),
  ])

  // Every file is located through the backend's own file list and fetched
  // from its download_url, once, even when two parts read it.
  const [classified, direction, movement, movementReport] = await Promise.all([
    download(artifacts, ARTIFACT_PATHS.classifiedEvents, signal),
    download(artifacts, ARTIFACT_PATHS.directionData, signal),
    download(artifacts, ARTIFACT_PATHS.movementSeries, signal),
    download(artifacts, ARTIFACT_PATHS.movementReport, signal),
  ])

  return {
    results,
    artifacts,
    classification: read(classified, countClassifications),
    events: read(classified, readCandidateEvents),
    direction: read(direction, readDirection),
    movement: read(movement, readMovementSeries),
    movementReport: read(movementReport, readMovementReport),
  }
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

/** The text of one result file, or why it is not available. */
async function download(
  artifacts: Part<Artifact[]>,
  path: string,
  signal: AbortSignal,
): Promise<Part<string>> {
  const name = fileNameOf(path)
  if (artifacts.state !== 'ready') {
    return {
      state: 'error',
      message: `The file list could not be loaded, so ${name} could not be found.`,
    }
  }
  const file = findArtifact(artifacts.data, path)
  if (!file) return { state: 'missing', message: `This job did not produce ${name}.` }
  return settle(() => getArtifactText(file.href, signal), signal)
}

/** A downloaded file, read into what a panel shows. A file that cannot be read is an error, never a guess. */
function read<T>(text: Part<string>, parse: (text: string) => T): Part<T> {
  if (text.state !== 'ready') return text
  try {
    return { state: 'ready', data: parse(text.data) }
  } catch (error) {
    return { state: 'error', message: messageOf(error) }
  }
}
