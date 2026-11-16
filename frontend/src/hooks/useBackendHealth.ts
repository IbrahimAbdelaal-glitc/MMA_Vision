import { useEffect, useState } from 'react'
import { getHealth } from '../services/api'
import { messageOf } from '../services/http'

export type BackendHealth =
  | { state: 'checking' }
  | { state: 'online'; version: string | null }
  | { state: 'offline'; message: string }

const RECHECK_ONLINE_MS = 30_000
/** Sooner while offline, so starting the backend is noticed without a reload. */
const RECHECK_OFFLINE_MS = 10_000

/** Whether the backend answers GET /, checked on load and then every so often. */
export function useBackendHealth(): BackendHealth {
  const [health, setHealth] = useState<BackendHealth>({ state: 'checking' })

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = () => {
      getHealth(controller.signal).then(
        ({ version }) => {
          if (controller.signal.aborted) return
          // Same answer as before: keep the same object, so nothing re-renders.
          setHealth((current) =>
            current.state === 'online' && current.version === version
              ? current
              : { state: 'online', version },
          )
          timer = setTimeout(check, RECHECK_ONLINE_MS)
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          const message = messageOf(error)
          setHealth((current) =>
            current.state === 'offline' && current.message === message
              ? current
              : { state: 'offline', message },
          )
          timer = setTimeout(check, RECHECK_OFFLINE_MS)
        },
      )
    }

    check()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [])

  return health
}
