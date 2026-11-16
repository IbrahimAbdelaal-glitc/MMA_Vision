import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FighterHud } from './FighterHud'

// Red's row from the project's real test-clip scorecard.
const redTally = { totalEvents: 8, punchLike: 5, kickLike: 3, strong: 7, veryStrong: 1 }

describe('FighterHud', () => {
  it('shows the total and the four breakdown counts for its fighter', () => {
    render(<FighterHud corner="red" tally={redTally} />)
    const hud = within(screen.getByRole('region', { name: 'Red fighter' }))

    expect(hud.getByLabelText('Detected strike-like events')).toHaveTextContent('08')
    expect(hud.getByText('Punch-like').parentElement).toHaveTextContent(/05$/)
    expect(hud.getByText('Kick-like').parentElement).toHaveTextContent(/03$/)
    expect(hud.getByText('Strong').parentElement).toHaveTextContent(/07$/)
    expect(hud.getByText('Very strong').parentElement).toHaveTextContent(/01$/)
  })

  it('labels the counts as estimates rather than confirmed contact', () => {
    render(<FighterHud corner="red" tally={redTally} />)

    expect(screen.getByRole('region', { name: 'Red fighter' })).toHaveTextContent(
      /not confirmed contact/i,
    )
  })

  it('names the blue fighter panel for the blue corner', () => {
    render(<FighterHud corner="blue" tally={null} />)

    expect(screen.getByRole('region', { name: 'Blue fighter' })).toHaveTextContent(
      /blue corner/i,
    )
  })
})
