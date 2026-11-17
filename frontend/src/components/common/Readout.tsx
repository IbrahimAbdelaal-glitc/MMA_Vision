/** A small labelled value in the top bar, such as the clock. */
export function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-none">
      <p className="text-[8px] font-semibold tracking-[0.8px] text-muted uppercase">{label}</p>
      <p className="mt-1.5 text-[17px] leading-5 font-bold tabular-nums">{value}</p>
    </div>
  )
}
