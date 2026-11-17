import { formatGrouped } from './format'
import { checkVideoFile } from './videoFile'

export type ReplayFileCheck =
  | {
      ok: true
      /** same-size: it has exactly the upload's size. unchecked: the backend did not report a size. */
      match: 'same-size' | 'unchecked'
    }
  | { ok: false; message: string }

/**
 * Whether a video chosen on this computer can stand in for the analysed
 * upload during replay. The API does not serve the uploaded video, so the
 * replay plays the user's own copy, and event times only line up with the
 * file that was analysed. A different size proves a different file; the same
 * size, to the byte, is the strongest check the browser can make without
 * reading the whole file.
 */
export function checkReplayFile(
  file: { name: string; size: number },
  uploadBytes: number | null,
): ReplayFileCheck {
  const basic = checkVideoFile(file)
  if (!basic.ok) return basic
  if (uploadBytes === null) return { ok: true, match: 'unchecked' }
  if (file.size !== uploadBytes) {
    return {
      ok: false,
      message:
        `This file is ${formatGrouped(file.size, 0)} bytes, but the analysed upload was ` +
        `${formatGrouped(uploadBytes, 0)} bytes. Choose the file that was uploaded, so the event times line up with the video.`,
    }
  }
  return { ok: true, match: 'same-size' }
}
