import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  DEFAULT_LIST_FRACTION,
  MIN_LIST_PANE_WIDTH,
  MIN_MAP_PANE_WIDTH,
  MIN_SPLIT_INNER_WIDTH,
  resolveEffectiveView,
  resolveListPaneWidth,
  snapListPaneWidth,
  splitPaneSpace,
} from '@/components/farm/split-layout'
import { SplitDivider } from '@/components/farm/SplitDivider'
import type { FarmView } from '@/components/farm/types'
import { cn } from '@/lib/utils'

type FarmSplitViewProps = {
  view: FarmView
  onViewChange: (view: FarmView) => void
  listFraction: number
  onListFractionChange: (fraction: number) => void
  list: ReactNode
  map: ReactNode
  onSplitAvailableChange?: (available: boolean) => void
}

export const FarmSplitView = ({
  view,
  onViewChange,
  listFraction,
  onListFractionChange,
  list,
  map,
  onSplitAvailableChange,
}: FarmSplitViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [innerWidth, setInnerWidth] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    setInnerWidth(container.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setInnerWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const splitAvailable =
    innerWidth !== null && innerWidth >= MIN_SPLIT_INNER_WIDTH

  useEffect(() => {
    onSplitAvailableChange?.(splitAvailable)
  }, [splitAvailable, onSplitAvailableChange])

  const effectiveView = resolveEffectiveView(view, splitAvailable)
  const width = innerWidth ?? 0
  const space = splitPaneSpace(width)
  const maxSplitListWidth = Math.max(
    MIN_LIST_PANE_WIDTH,
    space - MIN_MAP_PANE_WIDTH,
  )
  const listWidth =
    effectiveView === 'split'
      ? (dragWidth ?? resolveListPaneWidth(listFraction, width))
      : effectiveView === 'list'
        ? space
        : 0

  const changeView = (next: FarmView) => {
    if (next !== view) onViewChange(next)
  }

  const placeDivider = (next: number) => {
    if (next < MIN_LIST_PANE_WIDTH) {
      changeView('map')
      return null
    }
    if (next > maxSplitListWidth) {
      changeView('list')
      return null
    }
    changeView('split')
    return snapListPaneWidth(next, width)
  }

  const dragListWidth = (next: number) => setDragWidth(placeDivider(next))

  const endDrag = () => {
    if (dragWidth === null) return
    onListFractionChange(dragWidth / space)
    setDragWidth(null)
  }

  const applyListWidth = (next: number) => {
    const placed = placeDivider(next)
    if (placed !== null) onListFractionChange(placed / space)
  }

  const stepListWidth = (delta: number) => {
    if (effectiveView === 'list' && delta < 0) {
      changeView('split')
      return
    }
    if (effectiveView === 'map' && delta > 0) {
      changeView('split')
      return
    }
    let next = listWidth + delta
    while (
      next >= MIN_LIST_PANE_WIDTH &&
      next <= maxSplitListWidth &&
      snapListPaneWidth(next, width) === listWidth
    ) {
      next += delta
    }
    applyListWidth(next)
  }

  const jumpToEdge = (edge: 'start' | 'end') => {
    changeView(edge === 'start' ? 'map' : 'list')
  }

  const resetSplit = () => {
    onListFractionChange(DEFAULT_LIST_FRACTION)
    changeView('split')
  }

  const handleDraggingChange = useCallback(
    (dragging: boolean) => setIsDragging(dragging),
    [],
  )

  const showList = effectiveView !== 'map'
  const showMap = effectiveView !== 'list'

  return (
    <div
      ref={containerRef}
      className="flex min-h-80 min-w-0 flex-1 items-stretch"
    >
      {innerWidth === null ? null : (
        <>
          {showList ? (
            <div
              className={cn(
                'relative flex min-h-0 min-w-0 flex-col @container',
                effectiveView === 'split' ? 'shrink-0' : 'flex-1',
              )}
              style={
                effectiveView === 'split' ? { width: listWidth } : undefined
              }
            >
              <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
            </div>
          ) : null}
          {splitAvailable ? (
            <SplitDivider
              listWidth={listWidth}
              minListWidth={0}
              maxListWidth={space}
              onDrag={dragListWidth}
              onDragEnd={endDrag}
              onStep={stepListWidth}
              onJump={jumpToEdge}
              onReset={resetSplit}
              onDraggingChange={handleDraggingChange}
            />
          ) : null}
          {showMap ? (
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {map}
              {isDragging ? (
                <div aria-hidden="true" className="absolute inset-0 z-10" />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
