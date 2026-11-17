import type { Corner } from '../../types/dashboard'

/**
 * Class names for each fighter's corner colour. Written out in full so
 * Tailwind can find them when it scans the source.
 */
export const CORNER_STYLES: Record<
  Corner,
  {
    name: string
    text: string
    border: string
    fill: string
    tile: string
    card: string
  }
> = {
  blue: {
    name: 'Blue',
    text: 'text-corner-blue',
    border: 'border-corner-blue',
    fill: 'bg-corner-blue',
    tile: 'bg-corner-blue/15 text-corner-blue',
    card: 'border-corner-blue-line bg-corner-blue-surface',
  },
  red: {
    name: 'Red',
    text: 'text-corner-red',
    border: 'border-corner-red',
    fill: 'bg-corner-red',
    tile: 'bg-corner-red/15 text-corner-red',
    card: 'border-corner-red-line bg-corner-red-surface',
  },
}
