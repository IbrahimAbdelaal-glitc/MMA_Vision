import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { IdentityCheck as Check } from '../../types/live'
import { IdentityCheck } from './IdentityCheck'

const base: Check = {
  state: 'agree', liveSpanSeconds: 6, coveredSeconds: 5.9, uncoveredSeconds: 0.1, comparedSeconds: 4.7,
  notComparedSeconds: { ambiguous: 0.4, live_uncertain: 0, live_lost: 0, offline_missing: 0.8 },
  intervals: [],
}

describe('IdentityCheck', () => {
  it('shows nothing for a job without a live record', async () => {
    const { container } = render(<IdentityCheck jobId="j" fetchCheck={async () => ({ ...base, state: 'unavailable' })} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it('reports agreement and the time not compared', async () => {
    render(<IdentityCheck jobId="j" fetchCheck={async () => base} />)
    expect(await screen.findByText(/matched the final labels/)).toBeInTheDocument()
    expect(screen.getByText(/0\.4 s too close to tell, 0\.8 s fighter missing offline/)).toBeInTheDocument()
    expect(screen.getByText(/never counts as agreement/)).toBeInTheDocument()
  })

  it('lists disagreement intervals with both labels', async () => {
    const check: Check = { ...base, state: 'disagree', intervals: [{ start: 2.4, end: 4.1, notComparedSeconds: 0.2, identityLogEntry: 're-association (blue) at 2.40 s' }] }
    render(<IdentityCheck jobId="j" fetchCheck={async () => check} />)
    const list = await screen.findByRole('list', { name: 'Disagreement intervals' })
    expect(list).toHaveTextContent('Live (provisional) Blue = Final scorecard Red')
    expect(list).toHaveTextContent('re-association (blue) at 2.40 s')
  })
})
