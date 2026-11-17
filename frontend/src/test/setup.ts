import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Unmount whatever a test rendered so tests cannot leak DOM into each other,
// put back any network stub (see test/fakeBackend.ts), and clear the
// ?job= address a test may have left behind.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})
