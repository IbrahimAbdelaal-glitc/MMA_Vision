import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { FakeBackend } from './test/fakeBackend'

let backend: FakeBackend

beforeEach(() => {
  // jsdom cannot create blob: URLs. This is the only browser API replaced
  // here besides the network, and no test asserts on it.
  URL.createObjectURL = () => 'blob:mma-vision-test'
  URL.revokeObjectURL = () => {}
  backend = new FakeBackend().install()
})

function mp4(name = 'title-fight.mp4') {
  return new File(['0'.repeat(2048)], name, { type: 'video/mp4' })
}

/** Renders the dashboard and waits for its backend check to settle. */
async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await within(screen.getByRole('status', { name: 'Backend status' })).findByText(
    'Backend connected',
  )
  return user
}

describe('dashboard before any analysis exists', () => {
  it('opens on the Live Monitoring state', async () => {
    await renderApp()

    expect(screen.getByRole('tab', { name: 'Live Monitoring' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Match Ended' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it.each(['Blue fighter', 'Red fighter', 'Live metrics'])(
    'shows no numbers in the %s panel',
    async (name) => {
      await renderApp()

      expect(screen.getByRole('region', { name }).textContent).not.toMatch(/\d/)
    },
  )

  it('keeps the monitoring controls disabled and explains why', async () => {
    await renderApp()

    for (const name of ['Start monitoring', 'Pause monitoring', 'End monitoring']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(/live engine/i)
    }
  })
})

describe('choosing a video', () => {
  it('previews a chosen MP4 and labels it as not analysed', async () => {
    const user = await renderApp()

    await user.upload(screen.getByLabelText('Select MP4 video'), mp4())

    expect(screen.getByLabelText('Fight video')).toBeInstanceOf(HTMLVideoElement)
    expect(screen.getByText(/title-fight\.mp4/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/not analysed/i)
  })

  it('does not upload anything until Analyse video is chosen', async () => {
    const user = await renderApp()

    await user.upload(screen.getByLabelText('Select MP4 video'), mp4())

    expect(screen.getByRole('button', { name: 'Analyse video' })).toBeEnabled()
    expect(backend.uploads).toHaveLength(0)
  })

  it('accepts a video dropped onto the stage', async () => {
    await renderApp()

    fireEvent.drop(screen.getByRole('region', { name: 'Video stage' }), {
      dataTransfer: { files: [mp4('dropped.mp4')] },
    })

    expect(screen.getByLabelText('Fight video')).toBeInstanceOf(HTMLVideoElement)
    expect(screen.getByText(/dropped\.mp4/)).toBeInTheDocument()
  })

  it('refuses a non-MP4 file, says why, and leaves the stage empty', async () => {
    await renderApp()
    const user = userEvent.setup({ applyAccept: false })

    await user.upload(
      screen.getByLabelText('Select MP4 video'),
      new File(['0'], 'clip.avi', { type: 'video/x-msvideo' }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Only MP4 videos are supported.')
    expect(screen.queryByLabelText('Fight video')).not.toBeInTheDocument()
  })

  it('keeps the chosen video when switching to Match Ended and back', async () => {
    const user = await renderApp()
    await user.upload(screen.getByLabelText('Select MP4 video'), mp4())

    await user.click(screen.getByRole('tab', { name: 'Match Ended' }))
    expect(screen.queryByLabelText('Fight video')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Live Monitoring' }))
    expect(screen.getByLabelText('Fight video')).toBeInstanceOf(HTMLVideoElement)
  })
})

describe('Match Ended state with no results', () => {
  it('shows no scores and ranks no fighter', async () => {
    const user = await renderApp()

    await user.click(screen.getByRole('tab', { name: 'Match Ended' }))

    expect(screen.getByRole('tab', { name: 'Match Ended' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    for (const name of ['Blue fighter final score', 'Red fighter final score']) {
      expect(screen.getByRole('region', { name }).textContent).not.toMatch(/\d/)
    }
    expect(
      screen.getByRole('region', { name: 'Experimental activity result' }).textContent,
    ).not.toMatch(/blue|red/i)
  })
})
