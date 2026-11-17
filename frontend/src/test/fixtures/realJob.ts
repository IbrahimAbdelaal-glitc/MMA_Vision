import classifiedCsv from './classified_strike_candidates.csv?raw'
import scorecardReport from './experimental_scorecard_report.txt?raw'
import movementCsv from './movement_metrics_cleaned.csv?raw'
import movementReport from './movement_report.txt?raw'
import directionCsv from './opponent_direction_analysis.csv?raw'
import directionReport from './opponent_direction_report.txt?raw'

/*
 * One real run of the pipeline: job 4086db6d…, the 15-second clip
 * "mma cllip -1-highlight.mp4". The responses below are what api/main.py
 * returned for it; the CSV and report files are copied from its results
 * folder unchanged.
 */

export const JOB_ID = '4086db6d-8fa0-4e09-bda8-0d40af74974b'

export { classifiedCsv, directionCsv, directionReport, movementCsv, movementReport, scorecardReport }

/** The result files the dashboard downloads, by artifact path, as the real run wrote them. */
export const RESULT_FILES: Readonly<Record<string, string>> = {
  'results/classified_strike_candidates.csv': classifiedCsv,
  'results/opponent_direction_analysis.csv': directionCsv,
  'results/movement_metrics_cleaned.csv': movementCsv,
  'results/movement_report.txt': movementReport,
}

/** GET /jobs/{id} once the run had finished (the job's real status.json). */
export const COMPLETED_STATUS = {
  job_id: JOB_ID,
  status: 'completed',
  original_filename: 'mma cllip -1-highlight.mp4',
  file_size_bytes: 15230609,
  progress: 100,
  stages_completed: 9,
  total_stages: 9,
  current_stage: 'Completed',
  error: null,
  created_at: '2026-11-15T20:11:14.449222+00:00',
  updated_at: '2026-11-15T20:14:48.219733+00:00',
}

/** Right after the upload, before the background task starts. */
export const QUEUED_STATUS = {
  ...COMPLETED_STATUS,
  status: 'queued',
  progress: 0,
  stages_completed: 0,
  current_stage: 'Queued',
  updated_at: COMPLETED_STATUS.created_at,
}

/**
 * While the pipeline runs. pipeline.py does not flush its stage markers, so
 * the current backend stays at "Starting pipeline" and 0 % until the run ends.
 */
export const PROCESSING_STATUS = {
  ...QUEUED_STATUS,
  status: 'processing',
  current_stage: 'Starting pipeline',
}

/** The shape run_pipeline() writes when a stage script exits with an error. */
export const FAILED_STATUS = {
  ...COMPLETED_STATUS,
  status: 'failed',
  progress: 33,
  stages_completed: 3,
  current_stage: 'Failed',
  error: 'Pipeline exited with code 1. Check pipeline.log.',
}

/** GET /jobs/{id}/results: every scorecard value is a string, as csv.DictReader reads it. */
export const RESULTS = {
  job_id: JOB_ID,
  status: 'completed',
  scorecard: [
    {
      fighter: 'Blue',
      total_events: '3',
      punch_like: '3',
      kick_like: '0',
      strong_events: '1',
      very_strong_events: '2',
      activity_score: '8',
    },
    {
      fighter: 'Red',
      total_events: '8',
      punch_like: '5',
      kick_like: '3',
      strong_events: '7',
      very_strong_events: '1',
      activity_score: '17',
    },
  ],
  report: scorecardReport,
}

/** Every file the run wrote, with its real size in bytes. */
export const ARTIFACT_FILES: ReadonlyArray<readonly [string, number]> = [
  ['results/charts/cumulative_movement.png', 42444],
  ['results/charts/fighter_distance.png', 51842],
  ['results/charts/fighter_movement_speed.png', 110066],
  ['results/charts/wrist_activity.png', 62525],
  ['results/classified_strike_candidates.csv', 17747],
  ['results/experimental_scorecard.csv', 127],
  ['results/experimental_scorecard_report.txt', 1203],
  ['results/fighter_keypoints.csv', 679654],
  ['results/final_strike_candidates.csv', 3756],
  ['results/final_strike_report.txt', 1418],
  ['results/joint_features.csv', 1072456],
  ['results/movement_metrics.csv', 199592],
  ['results/movement_metrics_cleaned.csv', 314198],
  ['results/movement_report.txt', 886],
  ['results/opponent_direction_analysis.csv', 20085],
  ['results/opponent_direction_report.txt', 961],
  ['results/refined_strike_candidates.csv', 17418],
  ['results/refined_strike_report.txt', 1406],
  ['results/temporal_strike_candidates.csv', 26122],
  ['results/temporal_strike_report.txt', 335],
  ['videos/movement_analysis.mp4', 47523140],
]

/** GET /jobs/{id}/artifacts for a list of [path, size] pairs. */
export function artifactsResponse(
  files: ReadonlyArray<readonly [string, number]> = ARTIFACT_FILES,
  jobId = JOB_ID,
) {
  return {
    job_id: jobId,
    total_artifacts: files.length,
    artifacts: files.map(([filename, size]) => ({
      filename,
      size_bytes: size,
      download_url: `/jobs/${jobId}/files/${filename}`,
    })),
  }
}

export const ARTIFACTS = artifactsResponse()
