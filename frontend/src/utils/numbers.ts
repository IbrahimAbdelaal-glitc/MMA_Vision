/*
 * Strict conversion of the numbers the backend sends as text.
 *
 * The scorecard reaches the browser as CSV cells turned into JSON strings
 * ("8"), and CSV cells can be empty or "nan". Number() alone would read "" and
 * " " as 0 and "0x10" as 16, which would put a measurement on screen that
 * nobody made. Only plain decimal numbers are accepted; anything else is null,
 * and null is shown as a dash.
 */

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** A finite number from a number or a decimal string, otherwise null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const text = value.trim()
  if (!DECIMAL.test(text)) return null

  const number = Number(text)
  // "1e999" passes the pattern but overflows to Infinity.
  return Number.isFinite(number) ? number : null
}

/** A whole, non-negative number ("3" or "3.0"), otherwise null. */
export function toCount(value: unknown): number | null {
  const number = toNumber(value)
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null
}
