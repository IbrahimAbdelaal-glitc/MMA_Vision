import { describe, expect, it } from 'vitest'
import { checkReplayFile } from './replayFile'

describe('checkReplayFile', () => {
  it('accepts the file when it has exactly the size of the analysed upload', () => {
    expect(checkReplayFile({ name: 'fight.mp4', size: 15230609 }, 15230609)).toEqual({
      ok: true,
      match: 'same-size',
    })
  })

  it('refuses a file of a different size, giving both sizes in bytes', () => {
    const check = checkReplayFile({ name: 'fight.mp4', size: 15230610 }, 15230609)

    expect(check.ok).toBe(false)
    expect(!check.ok && check.message).toMatch(/15,230,610 bytes/)
    expect(!check.ok && check.message).toMatch(/15,230,609 bytes/)
  })

  it('accepts but flags a file when the backend did not report the upload size', () => {
    expect(checkReplayFile({ name: 'fight.mp4', size: 2048 }, null)).toEqual({ ok: true, match: 'unchecked' })
  })

  it('applies the same MP4 rules as the upload', () => {
    expect(checkReplayFile({ name: 'fight.mov', size: 2048 }, 2048)).toEqual({
      ok: false,
      message: 'Only MP4 videos are supported.',
    })
  })
})
