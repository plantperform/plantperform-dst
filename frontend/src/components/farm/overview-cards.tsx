import { useCallback, useState, type CSSProperties } from 'react'

import {
  moveOverviewBoundary,
  OVERVIEW_DEFAULT_FRACTIONS,
  OVERVIEW_MIN_CARD_WIDTHS,
  overviewCardSpace,
  overviewCardsFit,
  overviewDividerPosition,
  resolveOverviewCardWidths,
  toOverviewFractions,
  useOverviewFractions,
  type OverviewCardLayout,
} from '@/components/farm/overview-layout'
import { SplitDivider } from '@/components/farm/SplitDivider'

const ignoreDragging = () => {}

export const useOverviewCards = (
  layout: OverviewCardLayout,
  labels: string[],
) => {
  const [rowWidth, setRowWidth] = useState<number | null>(null)
  const [dragWidths, setDragWidths] = useState<number[] | null>(null)
  const { fractions, changeFractions, resetFractions } =
    useOverviewFractions(layout)

  const measureRow = useCallback((row: HTMLDivElement | null) => {
    if (!row) return
    setRowWidth(row.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setRowWidth(entry.contentRect.width)
    })
    observer.observe(row)
    return () => observer.disconnect()
  }, [])

  const minWidths = OVERVIEW_MIN_CARD_WIDTHS[layout]
  const defaultFractions = OVERVIEW_DEFAULT_FRACTIONS[layout]
  const sideBySide = rowWidth !== null && overviewCardsFit(rowWidth, minWidths)
  const widths = sideBySide
    ? (dragWidths ??
      resolveOverviewCardWidths(
        fractions,
        minWidths,
        overviewCardSpace(rowWidth, minWidths.length),
      ))
    : []

  const moveBoundary = (index: number, position: number) =>
    moveOverviewBoundary(widths, minWidths, defaultFractions, index, position)

  const endDrag = () => {
    if (dragWidths === null) return
    changeFractions(toOverviewFractions(dragWidths))
    setDragWidths(null)
  }

  const stepBoundary = (index: number, delta: number) => {
    const current = overviewDividerPosition(widths, index)
    const lowest = current - widths[index] + minWidths[index]
    const highest = current + widths[index + 1] - minWidths[index + 1]
    let target = current + delta
    let next = moveBoundary(index, target)
    while (
      Math.round(next[index]) === Math.round(widths[index]) &&
      target > lowest &&
      target < highest
    ) {
      target += delta
      next = moveBoundary(index, target)
    }
    changeFractions(toOverviewFractions(next))
  }

  const jumpBoundary = (index: number, edge: 'start' | 'end') => {
    const position = edge === 'start' ? 0 : Number.MAX_SAFE_INTEGER
    changeFractions(toOverviewFractions(moveBoundary(index, position)))
  }

  const rowStyle: CSSProperties | undefined = sideBySide
    ? { position: 'relative', flexWrap: 'nowrap' }
    : undefined
  const groupStyle: CSSProperties | undefined = sideBySide
    ? { display: 'contents' }
    : undefined
  const cardStyle = (index: number): CSSProperties | undefined =>
    sideBySide
      ? { flex: 'none', width: widths[index], minWidth: 0, maxWidth: 'none' }
      : undefined

  const handles = sideBySide
    ? widths.slice(1).map((_, offset) => (
        <SplitDivider
          key={labels[offset + 1]}
          label={`Skillelinje mellem ${labels[offset]} og ${labels[offset + 1]}`}
          className="absolute inset-y-0"
          style={{ left: overviewDividerPosition(widths, offset) }}
          listWidth={widths[offset]}
          minListWidth={minWidths[offset]}
          maxListWidth={Math.round(
            widths[offset] + widths[offset + 1] - minWidths[offset + 1],
          )}
          onDrag={(position) => setDragWidths(moveBoundary(offset, position))}
          onDragEnd={endDrag}
          onStep={(delta) => stepBoundary(offset, delta)}
          onJump={(edge) => jumpBoundary(offset, edge)}
          onReset={resetFractions}
          onDraggingChange={ignoreDragging}
        />
      ))
    : null

  return { measureRow, rowStyle, groupStyle, cardStyle, handles }
}
