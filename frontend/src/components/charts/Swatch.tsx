import { cx } from '../../utils/cx'

/** The small mark beside a legend or reading label that ties the text to its series. */
export function Swatch({ color, shape = 'dot' }: { color: string; shape?: 'dot' | 'line' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block shrink-0 rounded-full',
        shape === 'dot' ? 'size-2' : 'h-0.5 w-3.5',
      )}
      style={{ backgroundColor: color }}
    />
  )
}
