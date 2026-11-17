import { describe, expect, it } from 'vitest'
import { movementCsv, movementReport } from '../test/fixtures/realJob'
import { readMovementReport, readMovementSeries } from './movement'

/*
 * Expected values are copied from the real run's movement_metrics_cleaned.csv
 * and movement_report.txt (job 4086db6d), not computed by the test.
 */

describe('readMovementSeries', () => {
  it('reads every frame of movement_metrics_cleaned.csv', () => {
    const series = readMovementSeries(movementCsv)

    expect(series.time).toHaveLength(900)
    expect(series.time[0]).toBe(0)
    expect(series.time[899]).toBeCloseTo(14.983333, 5)
    expect(series.skippedRows).toBe(0)
  })

  it('takes the columns the backend’s own four charts plot', () => {
    const series = readMovementSeries(movementCsv)

    // Row 2 of the file (frame 1).
    expect(series.blueSpeed[1]).toBe(15.0)
    expect(series.redSpeed[1]).toBe(34.635254915624216)
    expect(series.blueWrist[1]).toBe(56.69364356994629)
    expect(series.redWrist[1]).toBe(32.23410892486572)
    expect(series.distance[1]).toBe(332.921296322265)
    expect(series.blueTotal[1]).toBe(0.0)
    expect(series.redTotal[1]).toBe(0.5)
    // The total movement at the last frame is the report's "Total movement".
    expect(series.blueTotal[899]).toBeCloseTo(3619.37, 2)
    expect(series.redTotal[899]).toBeCloseTo(4593.67, 2)
  })

  it('keeps an empty cell as a gap, not as zero', () => {
    const csv = [
      'frame,time_seconds,blue_total_movement_px,red_total_movement_px,blue_movement_speed_px_s_smoothed,red_movement_speed_px_s_smoothed,blue_wrist_speed_px_s_smoothed,red_wrist_speed_px_s_smoothed,fighter_distance_smoothed',
      '0,0.0,0.0,0.0,,12.5,,,300',
    ].join('\r\n')

    const series = readMovementSeries(csv)

    expect(series.blueSpeed).toEqual([null])
    expect(series.redSpeed).toEqual([12.5])
  })

  it('skips and counts a frame without a readable time', () => {
    const csv = [
      'frame,time_seconds,blue_total_movement_px,red_total_movement_px,blue_movement_speed_px_s_smoothed,red_movement_speed_px_s_smoothed,blue_wrist_speed_px_s_smoothed,red_wrist_speed_px_s_smoothed,fighter_distance_smoothed',
      '0,,0,0,1,1,1,1,1',
      '1,0.5,0,0,2,2,2,2,2',
    ].join('\n')

    const series = readMovementSeries(csv)

    expect(series.time).toEqual([0.5])
    expect(series.skippedRows).toBe(1)
  })

  it('names a column the file is missing', () => {
    expect(() => readMovementSeries('frame,time_seconds\n0,0\n')).toThrow(/blue_movement_speed_px_s_smoothed/)
  })
})

describe('readMovementReport', () => {
  it('reads every figure of movement_report.txt', () => {
    expect(readMovementReport(movementReport)).toEqual({
      frames: 900,
      durationSeconds: 14.98,
      blue: {
        movementSpeed: { median: 151.73, p95: 418.65 },
        wristSpeed: { median: 96.86, p95: 879.03 },
        ankleSpeed: { median: 64.18, p95: 577.63 },
        totalMovementPx: 3619.37,
      },
      red: {
        movementSpeed: { median: 163.22, p95: 577.37 },
        wristSpeed: { median: 122.48, p95: 805.7 },
        ankleSpeed: { median: 59.06, p95: 627.15 },
        totalMovementPx: 4593.67,
      },
      distance: { averagePx: 402.8, minimumPx: 170.88, maximumPx: 712.9 },
    })
  })

  it('shows a figure pandas wrote as nan as not measured', () => {
    const report = movementReport.replace('Median = 151.73 px/s', 'Median = nan px/s')

    expect(readMovementReport(report).blue.movementSpeed).toEqual({ median: null, p95: 418.65 })
  })

  it('refuses text that is not a movement report', () => {
    expect(() => readMovementReport('MMA VISION - FINAL STRIKE DETECTION\n')).toThrow(/movement_report\.txt/)
  })
})
