import type { Corner, DetectionClass, LiveMetrics, StrikeType } from './dashboard'

/*
 * The live engine's messages (design section 14), after normalisation.
 * Every value here is provisional: it comes from the live engine, not the
 * nine-stage offline pipeline, whose scorecard stays the final result.
 */

/** The verified facts about the uploaded video (POST /live-sessions, 201). */
export interface LiveVideo {
  fps: number
  frameCount: number
  width: number
  height: number
  durationSeconds: number
  /**
   * The stream's first timestamp. Chrome reports absolute media time, so the
   * engine's video time is currentTime minus this (measured with
   * requestVideoFrameCallback on both real clips; see docs/live-engine.md).
   */
  startOffsetMs: number
}

export type CornerState = 'tracked' | 'uncertain' | 'lost'

/** x, y in video pixels and the pose model's confidence; null where not reported. */
export type Keypoint = [number | null, number | null, number | null]

export interface LiveCorner {
  state: CornerState
  trackId: number | null
  /** x1, y1, x2, y2 in video pixels. */
  box: [number, number, number, number] | null
  keypoints: Keypoint[] | null
}

export interface LiveFrame {
  /** Verified video time of the analysed frame, in seconds. */
  t: number
  frameIndex: number
  corners: Record<Corner, LiveCorner>
  metrics: LiveMetrics
}

export type ScoreStatus = 'scored' | 'unscored_warm_up'

/** One provisional strike-like event, final once sent: never changed or withdrawn. */
export interface LiveEvent {
  id: string
  corner: Corner
  side: string
  type: StrikeType
  peakT: number
  peakFrame: number
  smoothedPeakSpeed: number | null
  keypointConfidence: number | null
  poolSize: number | null
  scoreStatus: ScoreStatus
  /** Heuristic ranking from 0 to 100; null while the stream's ranking pool is warming up. */
  kinematicScore: number | null
  detectionClass: DetectionClass | null
}

export interface LiveStats {
  framesAnalysed: number
  framesSkipped: number
  /** Analysed frames per second of video time, over the last 2 s. */
  analysedRate: number | null
  detectionActive: boolean
  detectionInactiveReason: string | null
  eventsEmitted: number
  eventsPerMinute: number | null
  eventsPerMinuteBasisSeconds: number | null
  unscoredEventCount: number
  heldCandidatesDiscardedByResets: number
  duplicatesDiscarded: number
  positionT: number | null
}

export interface IdentityEntry {
  kind: string
  corner: Corner | null
  frame: number | null
  t: number | null
  reason: string | null
}

export type EndReason = 'video_end' | 'stopped' | 'disconnected' | 'crashed'

export type EngineMessage =
  | { type: 'ready'; device: string | null; model: string | null }
  | { type: 'frame'; frame: LiveFrame }
  | { type: 'event'; event: Omit<LiveEvent, 'id'> }
  | { type: 'identity'; entry: IdentityEntry }
  | { type: 'stats'; stats: LiveStats }
  | { type: 'clock_rejected'; t: number | null; position: number | null; reason: string }
  | { type: 'ended'; reason: EndReason }
  | { type: 'error'; message: string; logTail: string[] }

/** GET /jobs/{id}/identity-check (design 12.4). */
export interface IdentityCheck {
  state: 'agree' | 'disagree' | 'not_compared' | 'unavailable'
  liveSpanSeconds: number | null
  coveredSeconds: number | null
  uncoveredSeconds: number | null
  comparedSeconds: number | null
  notComparedSeconds: Record<'ambiguous' | 'live_uncertain' | 'live_lost' | 'offline_missing', number>
  intervals: Array<{
    start: number
    end: number
    notComparedSeconds: number
    identityLogEntry: string | null
  }>
}
