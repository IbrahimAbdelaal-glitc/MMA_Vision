/**
 * An ISO 8601 timestamp from the backend, in milliseconds since 1970, or null.
 * Python's isoformat() writes microseconds ("20:11:14.449222+00:00"); only
 * the milliseconds are kept, because that is all a JavaScript Date holds.
 */
export function parseTimestamp(text: string | null): number | null {
  if (!text) return null
  const ms = Date.parse(text.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isNaN(ms) ? null : ms
}

/**
 * Whole seconds from a backend timestamp to another timestamp or to a moment
 * in milliseconds. Never negative; null when either moment is unknown.
 */
export function secondsBetween(start: string | null, end: string | number | null): number | null {
  const from = parseTimestamp(start)
  const to = typeof end === 'number' ? end : parseTimestamp(end)
  if (from === null || to === null) return null
  return Math.max(0, Math.floor((to - from) / 1000))
}
