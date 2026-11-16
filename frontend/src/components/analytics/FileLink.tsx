import { Download } from 'lucide-react'
import type { Artifact } from '../../types/api'
import { cx } from '../../utils/cx'

/**
 * A download link for one of the job's files. It points at the backend's own
 * download_url, through the dev-server proxy.
 *
 * The name "Download <file name>" is set with aria-label rather than built
 * from a visually hidden "Download " span: accessible-name algorithms trim
 * each element's text, so the space inside such a span can be lost and the
 * name read as "Downloadfinal_strike_candidates.csv".
 */
export function FileLink({ file, className }: { file: Artifact; className?: string }) {
  return (
    <a
      href={file.href}
      download={file.name}
      title={file.path}
      aria-label={`Download ${file.name}`}
      className={cx(
        // max-w-full lets a long name shrink to its container and end in an ellipsis.
        'inline-flex max-w-full min-w-0 items-center gap-1.5 font-medium text-fg-soft underline-offset-2 hover:text-fg hover:underline',
        className,
      )}
    >
      <Download size={12} aria-hidden className="shrink-0 text-muted" />
      <span className="min-w-0 truncate">{file.name}</span>
    </a>
  )
}
