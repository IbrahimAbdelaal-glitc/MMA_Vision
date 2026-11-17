import type { Artifact } from '../types/api'

/**
 * Where the pipeline writes the files the dashboard links to, relative to the
 * job folder, exactly as GET /jobs/{job_id}/artifacts lists them.
 */
export const ARTIFACT_PATHS = {
  classifiedEvents: 'results/classified_strike_candidates.csv',
  finalEvents: 'results/final_strike_candidates.csv',
  scorecardReport: 'results/experimental_scorecard_report.txt',
  movementReport: 'results/movement_report.txt',
  movementSeries: 'results/movement_metrics_cleaned.csv',
  directionReport: 'results/opponent_direction_report.txt',
  directionData: 'results/opponent_direction_analysis.csv',
  processedVideo: 'videos/movement_analysis.mp4',
  // The four charts src/analyze_movement.py draws with matplotlib.
  speedChart: 'results/charts/fighter_movement_speed.png',
  wristChart: 'results/charts/wrist_activity.png',
  distanceChart: 'results/charts/fighter_distance.png',
  cumulativeChart: 'results/charts/cumulative_movement.png',
} as const

export function findArtifact(artifacts: readonly Artifact[], path: string): Artifact | null {
  return artifacts.find((artifact) => artifact.path === path) ?? null
}

/** The file name at the end of an artifact path. */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
