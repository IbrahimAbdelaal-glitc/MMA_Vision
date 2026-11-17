import type { Corner, FighterTally, StrikeEvent } from '../types/dashboard'
import type { InferencePath, LiveEvent } from '../types/live'

/*
 * Live engine events in the shapes the dashboard panels already show.
 * Counts are of provisional events only; nothing here is a score total,
 * a leader or a winner.
 */

/** One fighter's provisional strike-like events, as the fighter HUD shows them. */
export function liveTally(events: readonly LiveEvent[], corner: Corner): FighterTally {
  const own = events.filter((e) => e.corner === corner)
  return {
    totalEvents: own.length,
    punchLike: own.filter((e) => e.type === 'punch-like').length,
    kickLike: own.filter((e) => e.type === 'kick-like').length,
    strong: own.filter((e) => e.detectionClass === 'Strong').length,
    veryStrong: own.filter((e) => e.detectionClass === 'Very Strong').length,
  }
}

export function toStrikeEvent(event: LiveEvent): StrikeEvent {
  return {
    id: event.id,
    corner: event.corner,
    timeSeconds: event.peakT,
    type: event.type,
    detectionClass: event.detectionClass,
    kinematicScore: event.kinematicScore,
    keypointConfidence: event.keypointConfidence,
    provisional: true,
  }
}

/** The engine-status suffix: where the engine runs and which inference path ran,
 * so a fallback from the CUDA graph is never silent. Unknown parts are left out. */
export function engineLocation(device: string | null, inference: InferencePath | null): string {
  let text = ''
  if (device) text = device === 'cpu' ? ' · CPU' : ` · GPU (${device})`
  if (inference) text += inference === 'cuda_graph' ? ' · CUDA graph' : ' · standard inference'
  return text
}
