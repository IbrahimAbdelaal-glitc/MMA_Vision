import type { Corner, DetectionClass, LiveMetrics, StrikeType } from '../types/dashboard'
import type {
  CornerState,
  EndReason,
  EngineMessage,
  IdentityCheck,
  Keypoint,
  LiveCorner,
  LiveStats,
  LiveVideo,
} from '../types/live'
import { ApiError, isRecord } from './http'

/*
 * Turns the live engine's JSON (design 14) into typed values. A value the
 * engine did not send, or sent in a form we do not recognise, becomes null:
 * nothing is filled in or estimated.
 */

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function int(value: unknown): number | null {
  const n = num(value)
  return n !== null && Number.isInteger(n) ? n : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

const CORNERS: readonly Corner[] = ['blue', 'red']
const STATES: readonly CornerState[] = ['tracked', 'uncertain', 'lost']
const CLASSES: readonly DetectionClass[] = ['Very Strong', 'Strong', 'Review', 'Low']
const END_REASONS: readonly EndReason[] = ['video_end', 'stopped', 'disconnected', 'crashed']

function corner(value: unknown): Corner | null {
  return CORNERS.includes(value as Corner) ? (value as Corner) : null
}

function unexpected(what: string): ApiError {
  return new ApiError('invalid-response', `The live engine sent an unrecognised ${what}.`)
}

export function normalizeLiveVideo(raw: unknown): LiveVideo {
  if (!isRecord(raw)) throw unexpected('video description')
  const fps = num(raw.fps)
  const frameCount = int(raw.frame_count)
  const width = num(raw.width)
  const height = num(raw.height)
  const durationSeconds = num(raw.duration_seconds)
  const startOffsetMs = num(raw.start_offset_ms)
  if (fps === null || frameCount === null || width === null || height === null || durationSeconds === null || startOffsetMs === null) {
    throw unexpected('video description')
  }
  return { fps, frameCount, width, height, durationSeconds, startOffsetMs }
}

/** POST /live-sessions, 201. */
export function normalizeLiveSession(raw: unknown): { sessionId: string; video: LiveVideo } {
  if (!isRecord(raw) || typeof raw.session_id !== 'string' || !raw.session_id) {
    throw unexpected('session answer')
  }
  return { sessionId: raw.session_id, video: normalizeLiveVideo(raw.video) }
}

function normalizeCorner(raw: unknown): LiveCorner {
  if (!isRecord(raw)) return { state: 'lost', trackId: null, box: null, keypoints: null }
  const state = STATES.includes(raw.state as CornerState) ? (raw.state as CornerState) : 'lost'
  const boxValues = Array.isArray(raw.box) ? raw.box.map(num) : []
  const box =
    boxValues.length === 4 && boxValues.every((v) => v !== null)
      ? (boxValues as [number, number, number, number])
      : null
  const keypoints = Array.isArray(raw.keypoints)
    ? raw.keypoints.map((point): Keypoint =>
        Array.isArray(point) ? [num(point[0]), num(point[1]), num(point[2])] : [null, null, null],
      )
    : null
  return { state, trackId: int(raw.track_id), box: state === 'tracked' ? box : null, keypoints: state === 'tracked' ? keypoints : null }
}

function normalizeMetrics(raw: unknown): LiveMetrics {
  const m = isRecord(raw) ? raw : {}
  return {
    distancePx: num(m.distance_px),
    distancePercentDiagonal: num(m.distance_percent_diagonal),
    blueSpeedPxPerSecond: num(m.blue_speed_px_s),
    redSpeedPxPerSecond: num(m.red_speed_px_s),
    strikeEventsPerMinute: num(m.strike_like_events_per_minute),
    keypointConfidence: num(m.keypoint_confidence),
    fightersTracked: int(m.fighters_tracked),
    keypointsTracked: int(m.keypoints_tracked),
  }
}

function normalizeStats(m: Record<string, unknown>): LiveStats {
  return {
    framesAnalysed: int(m.frames_analysed) ?? 0,
    framesSkipped: int(m.frames_skipped) ?? 0,
    analysedRate: num(m.analysed_rate),
    detectionActive: m.detection_active === true,
    detectionInactiveReason: text(m.detection_inactive_reason),
    eventsEmitted: int(m.events_emitted) ?? 0,
    eventsPerMinute: num(m.strike_like_events_per_minute),
    eventsPerMinuteBasisSeconds: num(m.events_per_minute_basis_seconds),
    unscoredEventCount: int(m.unscored_event_count) ?? 0,
    heldCandidatesDiscardedByResets: int(m.held_candidates_discarded_by_resets) ?? 0,
    duplicatesDiscarded: int(m.duplicates_discarded) ?? 0,
    positionT: num(m.position_t),
  }
}

/** One engine message, or null for a message type this dashboard does not use. */
export function normalizeEngineMessage(raw: unknown): EngineMessage | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'ready':
      return {
        type: 'ready',
        device: text(raw.device),
        model: text(raw.model),
        inference: raw.inference === 'cuda_graph' || raw.inference === 'eager' ? raw.inference : null,
      }
    case 'frame': {
      const t = num(raw.t)
      const frameIndex = int(raw.frame_index)
      if (t === null || frameIndex === null) return null
      const corners = isRecord(raw.corners) ? raw.corners : {}
      return {
        type: 'frame',
        frame: {
          t,
          frameIndex,
          corners: { blue: normalizeCorner(corners.blue), red: normalizeCorner(corners.red) },
          metrics: normalizeMetrics(raw.metrics),
        },
      }
    }
    case 'event': {
      const c = corner(raw.corner)
      const peakT = num(raw.peak_t)
      const peakFrame = int(raw.peak_frame)
      const type = raw.strike_type === 'punch-like' || raw.strike_type === 'kick-like' ? (raw.strike_type as StrikeType) : null
      if (!c || peakT === null || peakFrame === null || !type) return null
      const scored = raw.score_status === 'scored'
      const detectionClass = CLASSES.includes(raw.detection_class as DetectionClass)
        ? (raw.detection_class as DetectionClass)
        : null
      return {
        type: 'event',
        event: {
          corner: c,
          side: text(raw.side) ?? '',
          type,
          peakT,
          peakFrame,
          smoothedPeakSpeed: num(raw.smoothed_peak_speed),
          keypointConfidence: num(raw.keypoint_confidence),
          poolSize: int(raw.pool_size),
          scoreStatus: scored ? 'scored' : 'unscored_warm_up',
          kinematicScore: scored ? num(raw.kinematic_score) : null,
          detectionClass: scored ? detectionClass : null,
        },
      }
    }
    case 'identity':
      return {
        type: 'identity',
        entry: {
          kind: text(raw.kind) ?? 'identity',
          corner: corner(raw.corner),
          frame: int(raw.frame),
          t: num(raw.t),
          reason: text(raw.reason),
        },
      }
    case 'stats':
      return { type: 'stats', stats: normalizeStats(raw) }
    case 'clock_rejected':
      return {
        type: 'clock_rejected',
        t: num(raw.t),
        position: num(raw.position),
        reason: text(raw.reason) ?? 'The live engine never rewinds.',
      }
    case 'ended':
      return {
        type: 'ended',
        reason: END_REASONS.includes(raw.reason as EndReason) ? (raw.reason as EndReason) : 'crashed',
      }
    case 'error':
      return {
        type: 'error',
        message: text(raw.message) ?? 'The live engine reported an error.',
        logTail: Array.isArray(raw.log_tail) ? raw.log_tail.filter((l): l is string => typeof l === 'string') : [],
      }
    default:
      return null
  }
}

/** GET /jobs/{id}/identity-check */
export function normalizeIdentityCheck(raw: unknown): IdentityCheck {
  if (!isRecord(raw)) throw unexpected('identity check')
  const states = ['agree', 'disagree', 'not_compared', 'unavailable'] as const
  const state = states.find((s) => s === raw.state)
  if (!state) throw unexpected('identity check')
  const nc = isRecord(raw.not_compared_seconds) ? raw.not_compared_seconds : {}
  return {
    state,
    liveSpanSeconds: num(raw.live_span_seconds),
    coveredSeconds: num(raw.covered_seconds),
    uncoveredSeconds: num(raw.uncovered_seconds),
    comparedSeconds: num(raw.compared_seconds),
    notComparedSeconds: {
      ambiguous: num(nc.ambiguous) ?? 0,
      live_uncertain: num(nc.live_uncertain) ?? 0,
      live_lost: num(nc.live_lost) ?? 0,
      offline_missing: num(nc.offline_missing) ?? 0,
    },
    intervals: Array.isArray(raw.intervals)
      ? raw.intervals.flatMap((item) => {
          if (!isRecord(item)) return []
          const start = num(item.start)
          const end = num(item.end)
          if (start === null || end === null) return []
          return [{
            start,
            end,
            notComparedSeconds: num(item.not_compared_seconds) ?? 0,
            identityLogEntry: text(item.identity_log_entry),
          }]
        })
      : [],
  }
}
