import type { Artifact, ArtifactKind, Part } from '../../types/api'
import { formatFileSize } from '../../utils/format'
import { FileLink } from './FileLink'

const GROUPS: ReadonlyArray<readonly [ArtifactKind, string]> = [
  ['report', 'Reports'],
  ['table', 'Data tables'],
  ['chart', 'Charts'],
  ['video', 'Video'],
  ['other', 'Other files'],
]

/** Every file the run wrote, from GET /jobs/{job_id}/artifacts, grouped by kind. */
export function JobFiles({ artifacts }: { artifacts: Part<Artifact[]> }) {
  const files = artifacts.state === 'ready' ? artifacts.data : null
  const summary =
    artifacts.state === 'ready'
      ? `${artifacts.data.length} ${artifacts.data.length === 1 ? 'file' : 'files'} written by the analysis, downloaded from the backend`
      : `Unavailable: ${artifacts.message}`

  return (
    <section
      id="job-files"
      aria-label="Job files"
      className="min-w-0 scroll-mt-4 rounded-lg border border-line bg-panel"
    >
      <header className="px-5 pt-4 pb-3">
        <h2 className="text-[17px] leading-[21px] font-semibold">Job files</h2>
        <p className="mt-1 text-[11px] leading-[14px] text-muted">{summary}</p>
      </header>

      {files && files.length > 0 && (
        <div className="grid gap-x-8 gap-y-5 border-t border-line px-5 py-4 md:grid-cols-2">
          {GROUPS.map(([kind, label]) => {
            const group = files.filter((file) => file.kind === kind)
            if (group.length === 0) return null
            return (
              <div key={kind} className="min-w-0">
                <h3 className="caps-heading text-muted">{label}</h3>
                <ul className="mt-2 space-y-1.5">
                  {group.map((file) => (
                    <li
                      key={file.path}
                      className="flex items-center justify-between gap-3 text-[11px] leading-[14px]"
                    >
                      <FileLink file={file} />
                      <span className="shrink-0 text-muted tabular-nums">
                        {file.sizeBytes === null ? '—' : formatFileSize(file.sizeBytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
