import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LiveStats } from '../../types/live'
import { MonitoringControls } from './MonitoringControls'

const STATS: LiveStats = {
  framesAnalysed: 60,
  framesSkipped: 300,
  analysedRate: 10,
  detectionActive: false,
  detectionInactiveReason: 'analysed rate 10.0 /s is below the 20 /s limb-speed calculations need',
  eventsEmitted: 0,
  eventsPerMinute: null,
  eventsPerMinuteBasisSeconds: null,
  unscoredEventCount: 0,
  heldCandidatesDiscardedByResets: 0,
  duplicatesDiscarded: 0,
  positionT: 3,
}

function renderControls(stats: LiveStats = STATS) {
  const noop = () => {}
  return render(
    <MonitoringControls
      phase="live"
      startBlockedReason={null}
      uploadPercent={null}
      playing
      connection="open"
      device="cuda:0"
      inference="cuda_graph"
      stats={stats}
      endReason={null}
      onStart={noop}
      onTogglePlay={noop}
      onEnd={noop}
      onSwap={noop}
      onAnalyse={noop}
      onDiscard={noop}
    />,
  )
}

/** True when the element or an ancestor carries a class that hides it on short screens. */
function hiddenOnShortScreens(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (/(^|\s)squat:hidden(\s|$)/.test(node.className)) return true
  }
  return false
}

describe('live engine status on short screens', () => {
  // Regression: below 720 px of viewport height (a 1366x768 laptop browser)
  // the whole status block was hidden, so "Inactive" and its reason never showed.
  it('keeps the analysed rate and the detection state with its reason visible', () => {
    renderControls()
    const status = screen.getByLabelText('Live engine status')
    const rate = within(status).getByText('10.0 frames/s')
    const detection = within(status).getByText(/^Inactive: analysed rate 10\.0/)
    expect(hiddenOnShortScreens(rate)).toBe(false)
    expect(hiddenOnShortScreens(detection)).toBe(false)
  })

  it('keeps where the engine runs (device and inference mode) visible', () => {
    renderControls()
    const status = screen.getByLabelText('Live engine status')
    const engine = within(status).getByText(/GPU \(cuda:0\) · CUDA graph/)
    expect(hiddenOnShortScreens(engine)).toBe(false)
  })

  it('still lets the less essential rows go on short screens', () => {
    renderControls()
    const status = screen.getByLabelText('Live engine status')
    expect(hiddenOnShortScreens(within(status).getByText('60 · 300 skipped'))).toBe(true)
  })
})
