import { useCallback, useState } from 'react'

import {
  SPLIT_DIVIDER_WIDTH,
  snapToStops,
  splitSnapStops,
} from '@/components/farm/split-layout'

export type OverviewCardLayout = 'threeCards' | 'twoCards'

export const OVERVIEW_DEFAULT_FRACTIONS: Record<OverviewCardLayout, number[]> =
  {
    threeCards: [0.45, 0.25, 0.3],
    twoCards: [0.6, 0.4],
  }

export const OVERVIEW_MIN_CARD_WIDTHS: Record<OverviewCardLayout, number[]> = {
  threeCards: [448, 256, 288],
  twoCards: [448, 288],
}

export const OVERVIEW_CARD_GAP = 12
const HANDLE_INSET = (OVERVIEW_CARD_GAP - SPLIT_DIVIDER_WIDTH) / 2

const COLLAPSED_STORAGE_KEY = 'plantperform.farmOverviewCollapsed'
const FRACTIONS_STORAGE_KEY = 'plantperform.farmOverviewWidths'

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0)

export const overviewCardSpace = (rowWidth: number, cardCount: number) =>
  Math.max(0, rowWidth - (cardCount - 1) * OVERVIEW_CARD_GAP)

export const overviewCardsFit = (rowWidth: number, minWidths: number[]) =>
  overviewCardSpace(rowWidth, minWidths.length) >= sum(minWidths)

export const resolveOverviewCardWidths = (
  fractions: number[],
  minWidths: number[],
  space: number,
) => {
  const lifted = fractions.map((fraction, index) =>
    Math.max(fraction * space, minWidths[index]),
  )
  const excess = sum(lifted) - space
  if (excess <= 0) return lifted
  const spare = lifted.map((width, index) => width - minWidths[index])
  const totalSpare = sum(spare)
  if (totalSpare <= 0) return lifted
  return lifted.map(
    (width, index) => width - (excess * spare[index]) / totalSpare,
  )
}

export const moveOverviewBoundary = (
  widths: number[],
  minWidths: number[],
  defaultFractions: number[],
  index: number,
  position: number,
) => {
  const space = sum(widths)
  const before = sum(widths.slice(0, index))
  const pair = widths[index] + widths[index + 1]
  const defaultBoundary = Math.round(
    sum(defaultFractions.slice(0, index + 1)) * space,
  )
  const boundary = snapToStops(
    position - index * OVERVIEW_CARD_GAP - HANDLE_INSET,
    [defaultBoundary, ...splitSnapStops(space)],
  )
  const left = Math.max(
    minWidths[index],
    Math.min(pair - minWidths[index + 1], boundary - before),
  )
  const next = [...widths]
  next[index] = left
  next[index + 1] = pair - left
  return next
}

export const overviewDividerPosition = (widths: number[], index: number) =>
  sum(widths.slice(0, index + 1)) + index * OVERVIEW_CARD_GAP + HANDLE_INSET

export const toOverviewFractions = (widths: number[]) => {
  const space = sum(widths)
  return space > 0 ? widths.map((width) => width / space) : widths
}

export const parseOverviewFractions = (
  stored: string | null,
  layout: OverviewCardLayout,
) => {
  const fallback = OVERVIEW_DEFAULT_FRACTIONS[layout]
  if (!stored) return fallback
  try {
    const parsed: unknown = JSON.parse(stored)
    if (
      !Array.isArray(parsed) ||
      parsed.length !== fallback.length ||
      !parsed.every(
        (value) =>
          typeof value === 'number' && Number.isFinite(value) && value > 0,
      )
    ) {
      return fallback
    }
    return toOverviewFractions(parsed as number[])
  } catch {
    return fallback
  }
}

const fractionsStorageKey = (layout: OverviewCardLayout) =>
  `${FRACTIONS_STORAGE_KEY}.${layout}`

const readStoredFractions = (layout: OverviewCardLayout) => {
  try {
    return parseOverviewFractions(
      window.localStorage.getItem(fractionsStorageKey(layout)),
      layout,
    )
  } catch {
    return OVERVIEW_DEFAULT_FRACTIONS[layout]
  }
}

const readStoredCollapsed = () => {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export const useOverviewFractions = (layout: OverviewCardLayout) => {
  const [stored, setStored] = useState(() => ({
    layout,
    fractions: readStoredFractions(layout),
  }))
  const fractions =
    stored.layout === layout ? stored.fractions : readStoredFractions(layout)

  const changeFractions = useCallback(
    (next: number[]) => {
      setStored({ layout, fractions: next })
      try {
        window.localStorage.setItem(
          fractionsStorageKey(layout),
          JSON.stringify(next),
        )
      } catch {
        return
      }
    },
    [layout],
  )

  const resetFractions = useCallback(() => {
    setStored({ layout, fractions: OVERVIEW_DEFAULT_FRACTIONS[layout] })
    try {
      window.localStorage.removeItem(fractionsStorageKey(layout))
    } catch {
      return
    }
  }, [layout])

  return { fractions, changeFractions, resetFractions }
}

export const useOverviewCollapsed = () => {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed)

  const changeCollapsed = useCallback((next: boolean) => {
    setCollapsed(next)
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next))
    } catch {
      return
    }
  }, [])

  return { collapsed, changeCollapsed }
}
