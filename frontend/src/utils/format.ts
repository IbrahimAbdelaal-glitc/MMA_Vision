const BLANK_CLOCK = '--:--.---'
const BLANK = '—'
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/**
 * Seconds as a broadcast-style clock: "MM:SS.mmm", or "H:MM:SS.mmm" from one
 * hour up. Anything that is not a real, non-negative time shows a blank clock
 * instead of a made-up one.
 */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return BLANK_CLOCK

  // Round once, in whole milliseconds, then split. Splitting first would let
  // 59.9996 s print as "00:59.1000" instead of rolling over to "01:00.000".
  const totalMs = Math.round(seconds * 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const m = totalMinutes % 60
  const h = Math.floor(totalMinutes / 60)

  const tail = `${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`
  return h > 0 ? `${h}:${tail}` : tail
}

/**
 * A counter as the HUD shows it: two digits minimum ("08"). A value that is
 * not a whole, non-negative number is shown as a dash, never rounded or
 * guessed.
 */
export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isInteger(value) || value < 0) return BLANK
  return pad(value, 2)
}

/**
 * A measurement with a fixed number of decimals. A value that was never
 * measured is shown as a dash, not as zero.
 */
export function formatMeasure(value: number | null | undefined, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  return value.toFixed(decimals)
}

/**
 * A length of time in whole seconds: "MM:SS", or "H:MM:SS" from one hour up.
 * An unknown or impossible duration shows as a blank, not as zero.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--'

  const whole = Math.floor(seconds)
  const s = whole % 60
  const totalMinutes = Math.floor(whole / 60)
  const m = totalMinutes % 60
  const h = Math.floor(totalMinutes / 60)

  const tail = `${pad(m, 2)}:${pad(s, 2)}`
  return h > 0 ? `${h}:${tail}` : tail
}

/** File size the way Windows Explorer reports it (1 MB = 1024 × 1024 bytes). */
export function formatFileSize(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // At most one decimal, and no trailing ".0".
  return `${Math.round(value * 10) / 10} ${SIZE_UNITS[unit]}`
}
