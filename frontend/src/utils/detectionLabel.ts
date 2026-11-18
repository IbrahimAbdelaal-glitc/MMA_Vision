import type { DetectionClass } from '../types/dashboard'

/** Friendly dashboard wording while preserving the backend's class values. */
export function detectionLabel(value: DetectionClass | null | undefined): string {
  if (!value) return 'Unscored'
  return value === 'Very Strong' ? 'Significant' : value
}
