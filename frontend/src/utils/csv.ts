export interface CsvTable {
  columns: string[]
  /** One object per row, keyed by column name. Every value is still text. */
  rows: Record<string, string>[]
}

/**
 * Parses CSV the way Python's csv module and pandas write it: comma
 * separated, \r\n or \n line endings, and double-quoted fields that may hold
 * commas, doubled quotes ("") and line breaks. The first row is the header.
 *
 * Values are not converted here. Numbers go through utils/numbers, so an empty
 * cell stays "not measured" instead of becoming 0.
 */
export function parseCsv(text: string): CsvTable {
  const records = splitRecords(text.replace(/^﻿/, ''))
  if (records.length === 0) return { columns: [], rows: [] }

  const [columns, ...body] = records
  const rows = body
    // A blank line parses as a single empty field.
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells) => Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? ''])))

  return { columns, rows }
}

function splitRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char !== '"') {
        field += char
      } else if (text[i + 1] === '"') {
        field += '"'
        i += 1
      } else {
        quoted = false
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else {
      field += char
    }
  }

  // The last record when the text does not end with a line break.
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}
