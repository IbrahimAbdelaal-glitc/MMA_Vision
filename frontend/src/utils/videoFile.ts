import { formatFileSize } from './format'

/** Same limit as MAX_UPLOAD_SIZE in api/main.py. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

export type VideoFileCheck = { ok: true } | { ok: false; message: string }

/**
 * Checks a chosen file against the rules the backend enforces on upload
 * (MP4 only, not empty, at most 500 MB), so a file the backend would reject is
 * refused immediately with the reason, before any upload starts.
 */
export function checkVideoFile(file: { name: string; size: number }): VideoFileCheck {
  if (!file.name.toLowerCase().endsWith('.mp4')) {
    return { ok: false, message: 'Only MP4 videos are supported.' }
  }
  if (file.size === 0) {
    return { ok: false, message: 'This video file is empty.' }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `This video is ${formatFileSize(file.size)}. The backend accepts up to ${formatFileSize(MAX_UPLOAD_BYTES)}.`,
    }
  }
  return { ok: true }
}
