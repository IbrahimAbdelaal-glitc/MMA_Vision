/** ok: the backend answers. warn: it does not. muted: not checked yet. */
export type BackendTone = 'ok' | 'warn' | 'muted'

export const BACKEND_TONE_CLASSES: Record<BackendTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  muted: 'text-muted',
}
