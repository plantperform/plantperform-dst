import { useCallback, useState } from 'react'

export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 560
export const DEFAULT_SIDEBAR_WIDTH = 320
export const SIDEBAR_WIDTH_STEP = 16

const STORAGE_KEY = 'plantperform.farmSidebarWidth'

export const clampSidebarWidth = (width: number) =>
  Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))

const readStoredWidth = () => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_SIDEBAR_WIDTH
    const parsed = Number(stored)
    return Number.isFinite(parsed)
      ? clampSidebarWidth(parsed)
      : DEFAULT_SIDEBAR_WIDTH
  } catch {
    // Private mode or blocked site data: the width simply is not remembered.
    return DEFAULT_SIDEBAR_WIDTH
  }
}

/** Sidebar width in pixels, remembered per browser. */
export const useSidebarWidth = () => {
  const [width, setWidth] = useState(readStoredWidth)

  const changeWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next)
    setWidth(clamped)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clamped))
    } catch {
      // Not remembering the width is acceptable; resizing still works.
    }
  }, [])

  return { width, changeWidth }
}
