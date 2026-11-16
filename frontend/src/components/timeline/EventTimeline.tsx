const COLUMNS = [
  'Timestamp',
  'Fighter',
  'Estimated type',
  'Classification',
  'Points',
  'Keypoint confidence',
  'Kinematic score (heuristic)',
]

/**
 * Every estimated strike-like event of the finished analysis, one row each.
 * The rows are not filled in yet, so the table has its headings and `message`
 * explains where the events are, with no placeholder rows.
 */
export function EventTimeline({ message }: { message: string }) {
  return (
    <section
      aria-label="Event timeline and detailed statistics"
      className="overflow-hidden rounded-lg border border-line bg-panel"
    >
      <h2 className="px-5 pt-4 text-[17px] leading-[21px] font-semibold">
        Event timeline &amp; detailed statistics
      </h2>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-y border-line bg-panel-raised text-[9px] leading-[11px] tracking-[0.6px] text-muted uppercase">
              {COLUMNS.map((column) => (
                <th key={column} className="px-5 py-2 font-semibold whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={COLUMNS.length}
                className="px-5 py-3 text-[11px] leading-[14px] text-muted"
              >
                {message}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
