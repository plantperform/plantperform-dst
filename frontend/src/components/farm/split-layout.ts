import { useCallback, useState } from 'react'

import type { FarmView } from '@/components/farm/types'

export const MIN_LIST_PANE_WIDTH = 420
export const MIN_MAP_PANE_WIDTH = 360
export const SPLIT_STEP = 16
export const SPLIT_SNAP_FRACTIONS = [1 / 3, 1 / 2, 2 / 3]
export const SPLIT_SNAP_TOLERANCE = 24
export const MIN_SPLIT_INNER_WIDTH = 800
export const SPLIT_DIVIDER_WIDTH = 8
export const DEFAULT_LIST_FRACTION = 1 / 2

const VIEW_STORAGE_KEY = 'plantperform.farmView'
const FRACTION_STORAGE_KEY = 'plantperform.farmSplitFraction'
const DEFAULT_VIEW: FarmView = 'split'

const isFarmView = (value: string): value is FarmView =>
  value === 'list' || value === 'split' || value === 'map'

export const clampListFraction = (fraction: number) =>
  Math.min(1, Math.max(0, fraction))

export const splitPaneSpace = (innerWidth: number) =>
  Math.max(0, innerWidth - SPLIT_DIVIDER_WIDTH)

export const snapListPaneWidth = (width: number, innerWidth: number) => {
  const space = splitPaneSpace(innerWidth)
  let snapped = Math.round(width)
  for (const fraction of SPLIT_SNAP_FRACTIONS) {
    const stop = Math.round(fraction * space)
    if (Math.abs(snapped - stop) <= SPLIT_SNAP_TOLERANCE) {
      snapped = stop
      break
    }
  }
  return Math.max(
    MIN_LIST_PANE_WIDTH,
    Math.min(space - MIN_MAP_PANE_WIDTH, snapped),
  )
}

export const resolveEffectiveView = (
  view: FarmView,
  splitAvailable: boolean,
): FarmView => (view === 'split' && !splitAvailable ? 'list' : view)

export const resolveListPaneWidth = (fraction: number, innerWidth: number) =>
  snapListPaneWidth(
    clampListFraction(fraction) * splitPaneSpace(innerWidth),
    innerWidth,
  )

const readStoredView = (): FarmView => {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return stored && isFarmView(stored) ? stored : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

const readStoredFraction = () => {
  try {
    const stored = window.localStorage.getItem(FRACTION_STORAGE_KEY)
    if (!stored) return DEFAULT_LIST_FRACTION
    const parsed = Number(stored)
    return Number.isFinite(parsed)
      ? clampListFraction(parsed)
      : DEFAULT_LIST_FRACTION
  } catch {
    return DEFAULT_LIST_FRACTION
  }
}

export const useSplitLayout = () => {
  const [view, setView] = useState(readStoredView)
  const [listFraction, setListFraction] = useState(readStoredFraction)

  const changeView = useCallback((next: FarmView) => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      return
    }
  }, [])

  const changeListFraction = useCallback((next: number) => {
    const clamped = clampListFraction(next)
    setListFraction(clamped)
    try {
      window.localStorage.setItem(FRACTION_STORAGE_KEY, String(clamped))
    } catch {
      return
    }
  }, [])

  return { view, changeView, listFraction, changeListFraction }
}
