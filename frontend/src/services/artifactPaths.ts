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
  directionReport: 'results/opponent_direction_report.txt',
  directionData: 'results/opponent_direction_analysis.csv',
  processedVideo: 'videos/movement_analysis.mp4',
} as const

export function findArtifact(artifacts: readonly Artifact[], path: string): Artifact | null {
  return artifacts.find((artifact) => artifact.path === path) ?? null
}
