import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { messageOf } from '../services/http'
import { analyseLiveSession, createLiveSession, deleteLiveSession, liveStreamUrl } from '../services/liveApi'
import { clockMessage } from '../services/liveClock'
import { normalizeEngineMessage } from '../services/liveMessages'
import type { Corner } from '../types/dashboard'
import type {
  CornerState,
  EndReason,
  EngineMessage,
  IdentityEntry,
  InferencePath,
  LiveEvent,
  LiveFrame,
  LiveStats,
  LiveVideo,
} from '../types/live'

/*
 * One live session (design 7, 8, 14): upload, the engine's WebSocket,
 * the playback clock, and the hand-off to the offline pipeline.
 *
 * The browser's video is the clock. Every play, pause, seek, buffering
 * change and end is sent at once, and the position every 200 ms while
 * playing, so the engine analyses the latest frame the viewer has reached.
 * Pausing the video pauses the analysis.
 */

export type LivePhase = 'idle' | 'uploading' | 'starting' | 'live' | 'ended' | 'handing-off'
export type LiveConnection = 'none' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface LiveSessionState {
  phase: LivePhase
  file: File | null
  sessionId: string | null
  video: LiveVideo | null
  upload: { loaded: number; total: number } | null
  connection: LiveConnection
  device: string | null
  inference: InferencePath | null
  frame: LiveFrame | null
  /** Append-only, in the order the engine decided them. */
  events: LiveEvent[]
  stats: LiveStats | null
  cornerStates: Record<Corner, CornerState> | null
  identityLog: IdentityEntry[]
  endReason: EndReason | null
  error: string | null
  engineLog: string[]
  /** A passing remark, such as a refused backward seek. */
  notice: string | null
}

export const NO_SESSION: LiveSessionState = {
  phase: 'idle',
  file: null,
  sessionId: null,
  video: null,
  upload: null,
  connection: 'none',
  device: null,
  inference: null,
  frame: null,
  events: [],
  stats: null,
  cornerStates: null,
  identityLog: [],
  endReason: null,
  error: null,
  engineLog: [],
  notice: null,
}

type Action =
  | { type: 'upload-started'; file: File }
  | { type: 'upload-progress'; loaded: number; total: number }
  | { type: 'session-created'; sessionId: string; video: LiveVideo }
  | { type: 'failed'; message: string }
  | { type: 'connection'; value: LiveConnection }
  | { type: 'message'; message: EngineMessage }
  | { type: 'handing-off' }
  | { type: 'hand-off-failed'; message: string }
  | { type: 'reset' }
  | { type: 'dismiss' }

const MAX_IDENTITY_LOG = 50

function reducer(state: LiveSessionState, action: Action): LiveSessionState {
  switch (action.type) {
    case 'upload-started':
      return { ...NO_SESSION, phase: 'uploading', file: action.file, upload: { loaded: 0, total: action.file.size } }
    case 'upload-progress':
      return state.phase === 'uploading' ? { ...state, upload: { loaded: action.loaded, total: action.total } } : state
    case 'session-created':
      return { ...state, phase: 'starting', sessionId: action.sessionId, video: action.video, upload: null, connection: 'connecting' }
    case 'failed':
      return { ...NO_SESSION, error: action.message }
    case 'connection':
      return { ...state, connection: action.value }
    case 'handing-off':
      return { ...state, phase: 'handing-off', error: null }
    case 'hand-off-failed':
      return { ...state, phase: 'ended', error: action.message }
    case 'reset':
      return NO_SESSION
    case 'dismiss':
      return { ...state, error: null, notice: null }
    case 'message':
      return applyMessage(state, action.message)
  }
}

let nextEventId = 0

function applyMessage(state: LiveSessionState, message: EngineMessage): LiveSessionState {
  if (state.phase === 'idle' || state.phase === 'uploading') return state
  switch (message.type) {
    case 'ready':
      return { ...state, phase: state.phase === 'starting' ? 'live' : state.phase, device: message.device, inference: message.inference }
    case 'frame':
      return {
        ...state,
        frame: message.frame,
        cornerStates: { blue: message.frame.corners.blue.state, red: message.frame.corners.red.state },
      }
    case 'event':
      nextEventId += 1
      return { ...state, events: [...state.events, { ...message.event, id: `live-${nextEventId}` }] }
    case 'identity':
      return { ...state, identityLog: [...state.identityLog, message.entry].slice(-MAX_IDENTITY_LOG) }
    case 'stats':
      return { ...state, stats: message.stats }
    case 'clock_rejected':
      return { ...state, notice: 'The live engine never goes back. Analysis continues once playback passes the point it reached.' }
    case 'error':
      return { ...state, error: message.message, engineLog: message.logTail }
    case 'ended':
      return { ...state, phase: 'ended', endReason: message.reason, connection: 'closed' }
  }
}

/** A WebSocket as this hook uses it; tests pass a fake. */
export interface SocketLike {
  readyState: number
  send(data: string): void
  close(code?: number): void
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
}

export interface LiveApi {
  create: typeof createLiveSession
  analyse: typeof analyseLiveSession
  remove: typeof deleteLiveSession
}

const REAL_API: LiveApi = { create: createLiveSession, analyse: analyseLiveSession, remove: deleteLiveSession }

interface Options {
  /** The <video> element showing the same file: its playback is the engine's clock. */
  video: HTMLVideoElement | null
  /** The offline job that the live session became. */
  onHandedOff?: (jobId: string, file: File | null) => void
  createSocket?: (url: string) => SocketLike
  api?: LiveApi
}

const OPEN = 1
// Design 8 (amended by the fast-clock design): every 33 ms while playing, so 1x can reach
// ~30 analysed frames/s. The engine still never runs ahead of the last clock.
const CLOCK_INTERVAL_MS = 33
const MAX_RECONNECTS = 8
const CLOCK_EVENTS = ['play', 'pause', 'seeked', 'seeking', 'ended', 'playing', 'waiting'] as const

export function useLiveSession({ video, onHandedOff, createSocket, api = REAL_API }: Options) {
  const [state, dispatch] = useReducer(reducer, NO_SESSION)
  const stateRef = useRef(state)
  const socketRef = useRef<SocketLike | null>(null)
  const uploadController = useRef<AbortController | null>(null)
  const reconnects = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const waiting = useRef(false)
  const socketFactory = useRef(createSocket)
  const videoRef = useRef(video)
  const connectRef = useRef<(sessionId: string) => void>(() => {})
  // Callbacks read the latest values through refs, updated after each render.
  useLayoutEffect(() => {
    stateRef.current = state
    socketFactory.current = createSocket
    videoRef.current = video
  })

  const sendJson = useCallback((message: object) => {
    const socket = socketRef.current
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(message))
  }, [])

  const sendClock = useCallback(() => {
    const current = stateRef.current
    if (!video || !current.video) return
    sendJson(clockMessage(video, current.video.startOffsetMs, waiting.current))
  }, [video, sendJson])

  const connect = useCallback(
    (sessionId: string) => {
      const url = liveStreamUrl(sessionId)
      const socket = socketFactory.current ? socketFactory.current(url) : (new WebSocket(url) as unknown as SocketLike)
      socketRef.current = socket
      socket.onopen = () => {
        reconnects.current = 0
        dispatch({ type: 'connection', value: 'open' })
        sendClock()
      }
      socket.onmessage = (event: MessageEvent) => {
        let raw: unknown
        try {
          raw = JSON.parse(String(event.data))
        } catch {
          return
        }
        const message = normalizeEngineMessage(raw)
        if (message) dispatch({ type: 'message', message })
      }
      socket.onerror = () => {}
      socket.onclose = (event: CloseEvent) => {
        if (socketRef.current !== socket) return
        socketRef.current = null
        const phase = stateRef.current.phase
        if (event.code === 4404) {
          dispatch({ type: 'failed', message: 'The backend no longer has this live session (it may have restarted).' })
        } else if (event.code === 4409) {
          dispatch({ type: 'connection', value: 'closed' })
          dispatch({ type: 'failed', message: 'This live session is already open in another tab or window.' })
        } else if ((phase === 'starting' || phase === 'live') && reconnects.current < MAX_RECONNECTS) {
          // The backend keeps the session for 60 s without a client; the engine idles meanwhile.
          reconnects.current += 1
          dispatch({ type: 'connection', value: 'reconnecting' })
          const delay = Math.min(500 * 2 ** (reconnects.current - 1), 5000)
          reconnectTimer.current = setTimeout(() => connectRef.current(sessionId), delay)
        } else if (phase === 'starting' || phase === 'live') {
          dispatch({ type: 'connection', value: 'closed' })
          dispatch({ type: 'failed', message: 'Lost the connection to the live engine. Check that the backend is running.' })
        } else {
          dispatch({ type: 'connection', value: 'closed' })
        }
      }
    },
    [sendClock],
  )
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const closeSocket = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    reconnectTimer.current = null
    const socket = socketRef.current
    socketRef.current = null
    socket?.close(1000)
  }, [])

  /** Upload the file and start the engine. The video is rewound and paused first. */
  const start = useCallback(
    (file: File) => {
      uploadController.current?.abort()
      const controller = new AbortController()
      uploadController.current = controller
      // The engine starts at the first frame, so the viewer does too.
      const element = videoRef.current
      if (element) {
        element.pause()
        element.currentTime = 0
      }
      dispatch({ type: 'upload-started', file })
      api.create(file, {
        signal: controller.signal,
        onProgress: (loaded, total) => dispatch({ type: 'upload-progress', loaded, total }),
      }).then(
        ({ sessionId, video: facts }) => {
          if (controller.signal.aborted) return
          dispatch({ type: 'session-created', sessionId, video: facts })
          reconnects.current = 0
          connect(sessionId)
        },
        (error: unknown) => {
          if (!controller.signal.aborted) dispatch({ type: 'failed', message: messageOf(error) })
        },
      )
    },
    [api, connect],
  )

  /** End the session (reason "stopped"); its record stays for the offline hand-off. */
  const end = useCallback(() => {
    const phase = stateRef.current.phase
    if (phase === 'uploading') {
      uploadController.current?.abort()
      dispatch({ type: 'reset' })
      return
    }
    video?.pause()
    sendJson({ type: 'stop' })
  }, [sendJson, video])

  const swap = useCallback(() => sendJson({ type: 'swap' }), [sendJson])

  /** Stop the engine (if it still runs) and run the nine-stage analysis on the same file. */
  const analyseOffline = useCallback(async () => {
    const { sessionId, file } = stateRef.current
    if (!sessionId) return
    video?.pause()
    dispatch({ type: 'handing-off' })
    try {
      const { jobId } = await api.analyse(sessionId)
      closeSocket()
      dispatch({ type: 'reset' })
      onHandedOff?.(jobId, file)
    } catch (error) {
      dispatch({ type: 'hand-off-failed', message: messageOf(error) })
    }
  }, [api, closeSocket, onHandedOff, video])

  /** Stop the engine and delete the session's files. */
  const discard = useCallback(async () => {
    const { sessionId } = stateRef.current
    closeSocket()
    dispatch({ type: 'reset' })
    if (sessionId) {
      try {
        await api.remove(sessionId)
      } catch (error) {
        dispatch({ type: 'failed', message: messageOf(error) })
      }
    }
  }, [api, closeSocket])

  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), [])

  // The playback clock, while the engine's socket is open.
  const open = state.connection === 'open'
  useEffect(() => {
    if (!video || !open) return
    const onEvent = (event: Event) => {
      if (event.type === 'waiting') waiting.current = true
      if (event.type === 'playing' || event.type === 'seeked') waiting.current = false
      sendClock()
    }
    for (const name of CLOCK_EVENTS) video.addEventListener(name, onEvent)
    const timer = setInterval(() => {
      if (!video.paused && !video.ended) sendClock()
    }, CLOCK_INTERVAL_MS)
    return () => {
      for (const name of CLOCK_EVENTS) video.removeEventListener(name, onEvent)
      clearInterval(timer)
    }
  }, [video, open, sendClock])

  // Leaving the page closes the socket; the backend then pauses the engine and
  // ends the session after 60 s without a client.
  useEffect(() => () => {
    uploadController.current?.abort()
    closeSocket()
  }, [closeSocket])

  return { state, start, end, swap, analyseOffline, discard, dismiss }
}

export function isLiveActive(state: LiveSessionState): boolean {
  return state.phase !== 'idle'
}
