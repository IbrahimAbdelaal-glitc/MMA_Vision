import { describe, expect, it } from 'vitest'
import { classifiedCsv, directionCsv } from '../test/fixtures/realJob'
import type { CandidateEvent } from '../types/api'
import {
  adjacentEvent,
  directionByClass,
  linkDirection,
  readCandidateEvents,
  readDirection,
  scoredEvents,
  sortByPeak,
} from './events'

/*
 * The expected values below are read straight from the real run's CSV files
 * and from opponent_direction_report.txt, which the backend computed itself.
 */

describe('readCandidateEvents', () => {
  it('reads every candidate of the classification file, in file order', () => {
    const { events, unrecognisedRows } = readCandidateEvents(classifiedCsv)

    expect(events).toHaveLength(55)
    expect(unrecognisedRows).toBe(0)
    expect(events[0]).toEqual({
      id: 'event-1',
      corner: 'blue',
      detectionClass: 'Low',
      eventType: 'punch-like',
      side: 'right',
      startTime: 0,
      peakTime: 0.08333333333333333,
      endTime: 0.2833333333333333,
      peakSpeed: 1942.7653306563154,
      keypointConfidence: 0.9362988900000001,
      kinematicScore: 44.46,
    })
  })

  it('finds the eleven scored events: the Strong and Very Strong ones', () => {
    const scored = sortByPeak(scoredEvents(readCandidateEvents(classifiedCsv).events))

    expect(scored.map((event) => [event.corner, event.peakTime, event.detectionClass])).toEqual([
      ['red', 0.6166666666666667, 'Very Strong'],
      ['red', 1.0, 'Strong'],
      ['blue', 1.2833333333333334, 'Very Strong'],
      ['blue', 1.75, 'Very Strong'],
      // Two events peak at the same moment; file order breaks the tie.
      ['blue', 2.05, 'Strong'],
      ['red', 2.05, 'Strong'],
      ['red', 2.5166666666666666, 'Strong'],
      ['red', 3.4166666666666665, 'Strong'],
      ['red', 4.383333333333334, 'Strong'],
      ['red', 6.2, 'Strong'],
      ['red', 11.6, 'Strong'],
    ])
  })

  it('keeps an unreadable number as not measured instead of zero', () => {
    const csv = [
      'fighter,limb,event_type,start_time,peak_time,end_time,peak_speed_px_s,keypoint_confidence,kinematic_score,detection_class',
      'red,left,kick-like,1.0,,1.4,nan,0.9,70.1,Strong',
    ].join('\r\n')

    const [event] = readCandidateEvents(csv).events

    expect(event.peakTime).toBeNull()
    expect(event.peakSpeed).toBeNull()
    expect(event.startTime).toBe(1)
  })

  it('skips and counts rows whose fighter or class it does not recognise', () => {
    const csv = [
      'fighter,limb,event_type,start_time,peak_time,end_time,peak_speed_px_s,keypoint_confidence,kinematic_score,detection_class',
      'green,left,kick-like,1,1.1,1.2,900,0.9,70,Strong',
      'red,left,kick-like,1,1.1,1.2,900,0.9,70,Huge',
      'Red,left,kick-like,1,1.1,1.2,900,0.9,70,Strong',
    ].join('\n')

    const { events, unrecognisedRows } = readCandidateEvents(csv)

    expect(events.map((event) => event.id)).toEqual(['event-3'])
    expect(unrecognisedRows).toBe(2)
  })

  it('names a column the file is missing', () => {
    expect(() => readCandidateEvents('fighter,detection_class\r\nblue,Low\r\n')).toThrow(/peak_time/)
  })
})

describe('readDirection and linkDirection', () => {
  const { events } = readCandidateEvents(classifiedCsv)

  it('reads each event’s approach change, alignment and valid samples', () => {
    const { rows } = readDirection(directionCsv)

    expect(rows).toHaveLength(55)
    expect(rows[0]).toMatchObject({
      corner: 'blue',
      detectionClass: 'Low',
      peakTime: 0.08333333333333333,
      approachChange: -34.47720135751922,
      alignment: -0.9993436720778633,
      validSamples: 9,
    })
  })

  it('links every direction row to its event in the classification file', () => {
    const linked = linkDirection(events, readDirection(directionCsv).rows)

    expect(linked.every((row) => row.eventId !== null)).toBe(true)
    const blueVeryStrong = linked.find((row) => row.eventId === 'event-5')
    expect(blueVeryStrong).toMatchObject({ alignment: -0.8410568782027484, approachChange: -45.557246391688835 })
  })

  it('links by peak time within a microsecond, not by the exact text', () => {
    // pandas may rewrite a float's last digit when a later stage saves the
    // rows again, as happened in a real run (18.964674083333332 → …33333).
    const [event] = events
    const rewritten = { ...readDirection(directionCsv).rows[0], peakTime: event.peakTime! + 1e-9 }

    expect(linkDirection([event], [rewritten])[0].eventId).toBe(event.id)
    expect(linkDirection([event], [{ ...rewritten, peakTime: event.peakTime! + 0.01 }])[0].eventId).toBeNull()
  })

  it('averages each class exactly as opponent_direction_report.txt does', () => {
    const byClass = directionByClass(readDirection(directionCsv).rows)
    const shown = byClass.map((group) => [
      group.detectionClass,
      group.events,
      group.alignment?.toFixed(3),
      group.approachChange?.toFixed(2),
    ])

    // The report: Very Strong -0.339 / -80.96 px, Strong 0.252 / 7.42 px,
    // Review -0.060 / -19.87 px, Low -0.083 / 3.02 px.
    expect(shown).toEqual([
      ['Very Strong', 3, '-0.339', '-80.96'],
      ['Strong', 8, '0.252', '7.42'],
      ['Review', 15, '-0.060', '-19.87'],
      ['Low', 29, '-0.083', '3.02'],
    ])
  })

  it('leaves events without direction values out of the averages and counts them', () => {
    // The first two rows of the real file: a Low event, then a Review event.
    const [low, review] = readDirection(directionCsv).rows
    const unmeasured = { ...review, alignment: null, approachChange: null, validSamples: 2 }

    const byClass = directionByClass([low, unmeasured])

    expect(byClass.find((group) => group.detectionClass === 'Low')).toMatchObject({
      events: 1,
      measured: 1,
      alignment: low.alignment,
    })
    expect(byClass.find((group) => group.detectionClass === 'Review')).toMatchObject({
      events: 1,
      measured: 0,
      alignment: null,
      approachChange: null,
    })
  })
})

describe('adjacentEvent', () => {
  const ordered = sortByPeak(scoredEvents(readCandidateEvents(classifiedCsv).events))
  const ids = (event: CandidateEvent | null) => event?.id ?? null

  it('steps from the selected event to its neighbours in time order', () => {
    expect(ids(adjacentEvent(ordered, ordered[3].id, null, 1))).toBe(ordered[4].id)
    expect(ids(adjacentEvent(ordered, ordered[3].id, null, -1))).toBe(ordered[2].id)
  })

  it('stops at either end', () => {
    expect(adjacentEvent(ordered, ordered[0].id, null, -1)).toBeNull()
    expect(adjacentEvent(ordered, ordered.at(-1)!.id, null, 1)).toBeNull()
  })

  it('without a selection, starts from the replay position', () => {
    // At 3.0 s the next event starts at 3.283 s and the previous at 2.383 s.
    expect(adjacentEvent(ordered, null, 3, 1)?.startTime).toBe(3.283333333333333)
    expect(adjacentEvent(ordered, null, 3, -1)?.startTime).toBe(2.3833333333333333)
  })

  it('without a selection or a replay, goes to the first or last event', () => {
    expect(ids(adjacentEvent(ordered, null, null, 1))).toBe(ordered[0].id)
    expect(ids(adjacentEvent(ordered, null, null, -1))).toBe(ordered.at(-1)!.id)
  })
})
