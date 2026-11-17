import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'

// The project's real experimental_scorecard.csv, byte for byte (Python's csv
// module writes \r\n line endings).
const SCORECARD =
  'fighter,total_events,punch_like,kick_like,strong_events,very_strong_events,activity_score\r\n' +
  'Blue,3,3,0,1,2,8\r\n' +
  'Red,8,5,3,7,1,17\r\n'

describe('parseCsv', () => {
  it('reads the header and every row of the real scorecard', () => {
    const { columns, rows } = parseCsv(SCORECARD)

    expect(columns).toEqual([
      'fighter',
      'total_events',
      'punch_like',
      'kick_like',
      'strong_events',
      'very_strong_events',
      'activity_score',
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ fighter: 'Blue', activity_score: '8' })
    expect(rows[1]).toMatchObject({ fighter: 'Red', activity_score: '17' })
  })

  it('reads \\n line endings the same way', () => {
    const { rows } = parseCsv('a,b\n1,2\n3,4\n')

    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })

  it('keeps commas, doubled quotes and line breaks inside quoted fields', () => {
    const { rows } = parseCsv('label,note\r\n"Strike-like, movement","said ""high""\r\nthen low"\r\n')

    expect(rows).toEqual([{ label: 'Strike-like, movement', note: 'said "high"\r\nthen low' }])
  })

  it('keeps an empty cell as an empty string, never as a value', () => {
    const { rows } = parseCsv('a,b,c\r\n1,,3\r\n')

    expect(rows).toEqual([{ a: '1', b: '', c: '3' }])
  })

  it('ignores a byte-order mark and blank lines', () => {
    const { columns, rows } = parseCsv('﻿a,b\r\n1,2\r\n\r\n')

    expect(columns).toEqual(['a', 'b'])
    expect(rows).toEqual([{ a: '1', b: '2' }])
  })

  it('returns nothing for empty text', () => {
    expect(parseCsv('')).toEqual({ columns: [], rows: [] })
  })
})
