import type { Corner } from '../../types/dashboard'

/** A fighter's colour as a chart mark. Text beside a mark stays in the text colours. */
export const SERIES_COLORS: Record<Corner, string> = {
  blue: 'var(--color-series-blue)',
  red: 'var(--color-series-red)',
}

/** The colour of a chart with a single series, which belongs to neither fighter. */
export const NEUTRAL_SERIES = 'var(--color-fg-soft)'

/** The replay's position on a time axis: the Match Ended accent, never a fighter colour. */
export const PLAYHEAD_COLOR = 'var(--color-ended)'
