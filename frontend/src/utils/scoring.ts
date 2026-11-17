import type { Corner, DetectionClass } from '../types/dashboard'

/**
 * Points per classification. These are the project's experimental scoring
 * rules and must stay identical to POINTS in src/scoring.py.
 */
export const SCORING_RULES: ReadonlyArray<{ detectionClass: DetectionClass; points: number }> = [
  { detectionClass: 'Very Strong', points: 3 },
  { detectionClass: 'Strong', points: 2 },
  { detectionClass: 'Review', points: 0 },
  { detectionClass: 'Low', points: 0 },
]

export function pointsFor(detectionClass: DetectionClass): number {
  return SCORING_RULES.find((rule) => rule.detectionClass === detectionClass)?.points ?? 0
}

export type ScoreComparison =
  | { kind: 'higher'; corner: Corner; high: number; low: number }
  | { kind: 'tie'; score: number }

/**
 * Which fighter has the higher experimental activity score, or a tie. This
 * ranks the backend's two scores; it is never an official fight result.
 */
export function compareScores(blue: number | null, red: number | null): ScoreComparison | null {
  if (blue === null || red === null) return null
  if (blue === red) return { kind: 'tie', score: blue }
  return blue > red
    ? { kind: 'higher', corner: 'blue', high: blue, low: red }
    : { kind: 'higher', corner: 'red', high: red, low: blue }
}
