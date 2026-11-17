import { useEffect, useState } from 'react'

/**
 * The width of an element in CSS pixels, followed as it resizes, so an SVG
 * chart can draw at its real size instead of being scaled (scaling would
 * stretch the text and thicken the lines). Until the element has been
 * measured, and where ResizeObserver does not exist, the width is `fallback`.
 */
export function useElementWidth<T extends Element>(fallback: number) {
  const [element, setElement] = useState<T | null>(null)
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  // A hidden element measures 0; drawing nothing would help no one.
  return { ref: setElement, width: width !== null && width > 0 ? width : fallback }
}
