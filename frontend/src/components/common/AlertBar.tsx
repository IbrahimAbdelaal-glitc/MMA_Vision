import { CircleAlert, X } from 'lucide-react'

/** A problem the user needs to know about, shown under the top bar until dismissed. */
export function AlertBar({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="relative z-20 flex items-center gap-3 border-b border-corner-red-line bg-corner-red-surface px-4 py-2 xl:px-6"
    >
      <CircleAlert size={14} aria-hidden className="shrink-0 text-corner-red" />
      <p className="flex-1 text-xs leading-4">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="grid size-6 place-items-center rounded text-muted hover:text-fg"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}
