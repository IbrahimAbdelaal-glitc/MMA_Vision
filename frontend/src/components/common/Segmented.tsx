import { cx } from '../../utils/cx'

interface SegmentedProps<T extends string> {
  /** Names the group for screen readers, such as "Events shown". */
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * A row of toggle buttons where exactly one is on. Each button reports its
 * state with aria-pressed; they switch what a panel shows, they are not
 * tabs that move between panels.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        'inline-flex flex-wrap gap-0.5 rounded-md border border-line bg-panel-raised p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cx(
              'h-7 rounded-[5px] px-2.5 text-[11px] leading-[14px] font-semibold whitespace-nowrap transition-colors',
              on ? 'bg-control text-fg' : 'text-muted hover:bg-control/50 hover:text-fg',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
