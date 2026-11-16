/** The two fighters are always identified by corner colour. */
export type Corner = 'blue' | 'red'

/** The dashboard has exactly two states. */
export type DashboardView = 'live' | 'ended'

/** A video chosen on this computer. It has not been uploaded or analysed. */
export interface LocalVideoSource {
  file: File
  name: string
  sizeBytes: number
  /** blob: URL the <video> element plays from. */
  url: string
}

/**
 * Strike-like event counts for one fighter. The fields match the columns of
 * the backend's experimental_scorecard.csv.
 */
export interface FighterTally {
  totalEvents: number
  punchLike: number
  kickLike: number
  strong: number
  veryStrong: number
}

export type StrikeType = 'punch-like' | 'kick-like'

/** The four classes the pipeline's classification stage assigns. */
export type DetectionClass = 'Very Strong' | 'Strong' | 'Review' | 'Low'

/** One estimated strike-like event. It is a movement candidate, not a confirmed landed strike. */
export interface StrikeEvent {
  id: string
  corner: Corner
  /** Peak of the movement, in seconds from the start of the video. */
  timeSeconds: number
  type: StrikeType
  detectionClass: DetectionClass
  /** Heuristic ranking from 0 to 100. It is not a probability. */
  kinematicScore: number
  /** Mean pose keypoint confidence for the limb, from 0 to 1. */
  keypointConfidence: number
}

/**
 * Measurements shown in the live metrics panel. Each one is null until the
 * system has actually measured it.
 */
export interface LiveMetrics {
  distancePx: number | null
  distancePercentDiagonal: number | null
  blueSpeedPxPerSecond: number | null
  redSpeedPxPerSecond: number | null
  strikeEventsPerMinute: number | null
  /** Mean pose keypoint confidence across tracked joints, from 0 to 1. */
  keypointConfidence: number | null
  fightersTracked: number | null
  keypointsTracked: number | null
}
