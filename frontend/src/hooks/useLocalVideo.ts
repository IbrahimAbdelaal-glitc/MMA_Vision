import { useCallback, useEffect, useState } from 'react'
import type { LocalVideoSource } from '../types/dashboard'
import { checkVideoFile } from '../utils/videoFile'

/**
 * Holds the video the user chose on this computer so it can be previewed in
 * the stage. Choosing a file does not upload or analyse anything.
 */
export function useLocalVideo() {
  const [source, setSource] = useState<LocalVideoSource | null>(null)
  const [error, setError] = useState<string | null>(null)

  const select = useCallback((file: File) => {
    const check = checkVideoFile(file)
    if (!check.ok) {
      // Keep whatever was already loaded; only report why this file was refused.
      setError(check.message)
      return
    }
    setError(null)
    setSource({
      file,
      name: file.name,
      sizeBytes: file.size,
      url: URL.createObjectURL(file),
    })
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  // A blob: URL keeps the whole file reachable until it is revoked, so release
  // the previous one whenever the source is replaced or the app closes.
  useEffect(() => {
    if (!source) return
    return () => URL.revokeObjectURL(source.url)
  }, [source])

  return { source, error, select, dismissError }
}
