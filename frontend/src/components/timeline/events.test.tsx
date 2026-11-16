import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StrikeEvent } from '../../types/dashboard'
import { LatestEvent } from './LatestEvent'
import { RecentDetections } from './RecentDetections'

// Two rows from the project's real final_strike_candidates.csv.
const redPunch: StrikeEvent = {
  id: 'red-0.617',
  corner: 'red',
  timeSeconds: 0.6166666666666667,
  type: 'punch-like',
  detectionClass: 'Very Strong',
  kinematicScore: 80.47,
  keypointConfidence: 0.9095979683333333,
}
const bluePunch: StrikeEvent = {
  id: 'blue-1.283',
  corner: 'blue',
  timeSeconds: 1.2833333333333334,
  type: 'punch-like',
  detectionClass: 'Very Strong',
  kinematicScore: 96.33,
  keypointConfidence: 0.9359694799999999,
}

describe('LatestEvent', () => {
  it('shows who, what, when and how the event was classified', () => {
    render(<LatestEvent event={bluePunch} />)
    const card = screen.getByRole('region', { name: 'Latest detected event' })

    expect(card).toHaveTextContent('Blue')
    expect(card).toHaveTextContent('Punch-like motion')
    expect(card).toHaveTextContent('00:01.283')
    expect(card).toHaveTextContent('Very Strong')
  })

  it('reports the kinematic score as a heuristic and never as a percentage', () => {
    render(<LatestEvent event={bluePunch} />)
    const card = screen.getByRole('region', { name: 'Latest detected event' })

    expect(card).toHaveTextContent(/96\.3/)
    expect(card).toHaveTextContent(/heuristic/i)
    expect(card).toHaveTextContent(/0\.94/)
    expect(card.textContent).not.toContain('%')
  })

  it('says that nothing has been detected when there is no event', () => {
    render(<LatestEvent event={null} />)
    const card = screen.getByRole('region', { name: 'Latest detected event' })

    expect(card).toHaveTextContent(/no strike-like events/i)
    expect(card.textContent).not.toMatch(/\d/)
  })
})

describe('RecentDetections', () => {
  it('lists the newest detection first', () => {
    render(<RecentDetections events={[redPunch, bluePunch]} />)
    const rows = within(screen.getByRole('table', { name: 'Recent detections' })).getAllByRole('row')

    // rows[0] is the header row.
    expect(rows[1]).toHaveTextContent('00:01.283')
    expect(rows[1]).toHaveTextContent('Blue')
    expect(rows[2]).toHaveTextContent('00:00.617')
    expect(rows[2]).toHaveTextContent('Red')
  })

  it('shows only the most recent rows when a limit is given', () => {
    render(<RecentDetections events={[redPunch, bluePunch]} limit={1} />)
    const rows = within(screen.getByRole('table', { name: 'Recent detections' })).getAllByRole('row')

    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('00:01.283')
  })

  it('explains the empty table instead of showing placeholder rows', () => {
    render(<RecentDetections events={[]} />)
    const table = screen.getByRole('table', { name: 'Recent detections' })

    expect(table).toHaveTextContent(/no detections yet/i)
    expect(table.textContent).not.toMatch(/\d/)
  })
})
