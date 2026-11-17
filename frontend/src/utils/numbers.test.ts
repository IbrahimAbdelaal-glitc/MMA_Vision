import { describe, expect, it } from 'vitest'
import { toCount, toNumber } from './numbers'

describe('toNumber', () => {
  it.each([
    ['8', 8],
    [' 17 ', 17],
    ['3.0', 3],
    ['-3.4627014598682564', -3.4627014598682564],
    ['0.9362988900000001', 0.9362988900000001],
    ['1e3', 1000],
    ['.5', 0.5],
  ])('reads the numeric string %j as %d', (text, expected) => {
    expect(toNumber(text)).toBe(expected)
  })

  it('passes real numbers through', () => {
    expect(toNumber(42)).toBe(42)
    expect(toNumber(0)).toBe(0)
  })

  // An empty CSV cell means "not measured". Number('') would say 0.
  it.each(['', '   ', 'nan', 'NaN', 'inf', 'Infinity', '0x10', '12abc', '1,5', '1e999'])(
    'refuses %j instead of guessing a value',
    (text) => {
      expect(toNumber(text)).toBeNull()
    },
  )

  it.each([null, undefined, true, {}, [], Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses the non-numeric value %j',
    (value) => {
      expect(toNumber(value)).toBeNull()
    },
  )
})

describe('toCount', () => {
  it.each([
    ['3', 3],
    ['3.0', 3],
    ['0', 0],
    [17, 17],
  ])('reads %j as the count %d', (value, expected) => {
    expect(toCount(value)).toBe(expected)
  })

  it.each(['2.5', '-1', '', 'nan', null])('refuses %j as a count', (value) => {
    expect(toCount(value)).toBeNull()
  })
})
