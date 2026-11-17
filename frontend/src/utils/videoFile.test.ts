import { describe, expect, it } from 'vitest'
import { checkVideoFile } from './videoFile'

describe('checkVideoFile', () => {
  it('accepts an MP4 within the size limit', () => {
    expect(checkVideoFile({ name: 'fight.mp4', size: 15230609 })).toEqual({ ok: true })
  })

  it('accepts an upper-case .MP4 extension', () => {
    expect(checkVideoFile({ name: 'FIGHT.MP4', size: 1000 })).toEqual({ ok: true })
  })

  it('rejects other video formats with the same wording the backend uses', () => {
    expect(checkVideoFile({ name: 'clip.avi', size: 1000 })).toEqual({
      ok: false,
      message: 'Only MP4 videos are supported.',
    })
  })

  it('rejects a file that only contains .mp4 inside its name', () => {
    expect(checkVideoFile({ name: 'fight.mp4.exe', size: 1000 })).toEqual({
      ok: false,
      message: 'Only MP4 videos are supported.',
    })
  })

  it('rejects an empty file', () => {
    expect(checkVideoFile({ name: 'fight.mp4', size: 0 })).toEqual({
      ok: false,
      message: 'This video file is empty.',
    })
  })

  it('accepts a file exactly at the 500 MB backend limit', () => {
    expect(checkVideoFile({ name: 'fight.mp4', size: 524288000 })).toEqual({ ok: true })
  })

  it('rejects a file one byte over the limit and states both sizes', () => {
    expect(checkVideoFile({ name: 'fight.mp4', size: 629145600 })).toEqual({
      ok: false,
      message: 'This video is 600 MB. The backend accepts up to 500 MB.',
    })
    expect(checkVideoFile({ name: 'fight.mp4', size: 524288001 }).ok).toBe(false)
  })
})
