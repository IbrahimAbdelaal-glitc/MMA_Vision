import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LiveMetrics } from '../../types/dashboard'
import { LiveMetricsPanel } from './LiveMetricsPanel'

// Values of the kind the pipeline really produces (first frame of the test
// clip for distance, medians from its movement report for speed).
const measured: LiveMetrics = {
  distancePx: 333.1096,
  distancePercentDiagonal: 15.3216,
  blueSpeedPxPerSecond: 151.73,
  redSpeedPxPerSecond: 163.22,
  strikeEventsPerMinute: 44,
  keypointConfidence: 0.937,
  fightersTracked: 2,
  keypointsTracked: 24,
}

function panel() {
  return screen.getByRole('region', { name: 'Live metrics' })
}

describe('LiveMetricsPanel', () => {
  it('reports fighter distance in pixels and as a share of the frame diagonal, never in metres', () => {
    render(<LiveMetricsPanel metrics={measured} />)

    expect(panel()).toHaveTextContent(/333\s*px/)
    expect(panel()).toHaveTextContent(/15\.3\s*% of frame diagonal/)
    expect(panel().textContent).not.toMatch(/\bm\b|metre|meter/i)
  })

  it('shows pose keypoint confidence as the raw model score, not a percentage', () => {
    render(<LiveMetricsPanel metrics={measured} />)

    expect(screen.getByText('Pose keypoint confidence').parentElement).toHaveTextContent(/0\.94$/)
  })

  it('shows each fighter speed in pixels per second', () => {
    render(<LiveMetricsPanel metrics={measured} />)

    expect(screen.getByText('Blue movement speed').parentElement).toHaveTextContent(/152$/)
    expect(screen.getByText('Red movement speed').parentElement).toHaveTextContent(/163$/)
    expect(panel()).toHaveTextContent('px/s')
  })

  it('shows how many fighters and keypoints are tracked out of the possible total', () => {
    render(<LiveMetricsPanel metrics={measured} />)

    expect(screen.getByText('Fighters tracked').parentElement).toHaveTextContent(/2 \/ 2$/)
    expect(screen.getByText('Keypoints tracked').parentElement).toHaveTextContent(/24 \/ 24$/)
  })

  it('leaves a single unmeasured value blank while showing the rest', () => {
    render(<LiveMetricsPanel metrics={{ ...measured, redSpeedPxPerSecond: null }} />)

    expect(screen.getByText('Red movement speed').parentElement).toHaveTextContent(/—$/)
    expect(screen.getByText('Blue movement speed').parentElement).toHaveTextContent(/152$/)
  })
})
