import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LiveFrame } from '../../types/live'
import { LiveOverlay } from './LiveOverlay'

const points = Array.from({ length: 17 }, (_, i) => [100 + i * 5, 200 + i * 10, 0.9] as [number, number, number])

const frame: LiveFrame = {
  t: 1.0,
  frameIndex: 60,
  corners: {
    blue: { state: 'tracked', trackId: 1, box: [80, 180, 300, 600], keypoints: points },
    red: { state: 'lost', trackId: null, box: null, keypoints: null },
  },
  metrics: {} as LiveFrame['metrics'],   // not read by the overlay
}

function video(currentTime: number, paused: boolean) {
  const element = document.createElement('video')
  Object.defineProperty(element, 'currentTime', { value: currentTime })
  Object.defineProperty(element, 'paused', { value: paused })
  return element
}

const props = { width: 1920, height: 1020, startOffsetMs: 36, intervalSeconds: 1 / 60 }

describe('LiveOverlay', () => {
  it('draws the tracked fighter when the result is for the frame on screen', async () => {
    render(<LiveOverlay frame={frame} video={video(1.036, true)} {...props} />)
    const overlay = await screen.findByRole('img', { name: 'Live pose overlay (provisional)' })
    expect(overlay.querySelectorAll('g[data-corner]')).toHaveLength(1)
    expect(overlay).toHaveTextContent('Blue · provisional')
  })

  it('hides a result the video has moved past, and says how far behind it is', async () => {
    render(<LiveOverlay frame={frame} video={video(1.336, false)} {...props} />)
    expect(await screen.findByText(/Pose overlay hidden while playing: the newest result is 300 ms behind/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Live pose overlay (provisional)' })).toBeNull()
  })

  it('says nothing while paused on a frame the engine has not reached yet', async () => {
    render(<LiveOverlay frame={frame} video={video(1.336, true)} {...props} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/overlay hidden/)).toBeNull()
  })
})
