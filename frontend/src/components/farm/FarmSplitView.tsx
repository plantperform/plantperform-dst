import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  DEFAULT_LIST_SLACK,
  MIN_LIST_PANE_WIDTH,
  MIN_MAP_PANE_WIDTH,
  MIN_SPLIT_INNER_WIDTH,
  PANEL_WIDE_WIDTH,
  PANEL_WIDTH,
  SPLIT_DIVIDER_WIDTH,
  SPLIT_SNAP_TOLERANCE,
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
  listSlack: number
  onListSlackChange: (slack: number) => void
  listRequiredWidth: number | null
  list: (options: { width: number }) => ReactNode
  map: ReactNode
  renderPanel?: (options: {
    listBehind: boolean
    mapVisible: boolean
  }) => ReactNode
  panelWide?: boolean
  onSplitAvailableChange?: (available: boolean) => void
}

export const FarmSplitView = ({
  view,
  onViewChange,
  listSlack,
  onListSlackChange,
  listRequiredWidth,
  list,
  map,
  renderPanel,
  panelWide = false,
  onSplitAvailableChange,
}: FarmSplitViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [innerWidth, setInnerWidth] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [widthSettled, setWidthSettled] = useState(false)

  useEffect(() => {
    if (listRequiredWidth === null) return
    const frame = window.requestAnimationFrame(() => setWidthSettled(true))
    return () => window.cancelAnimationFrame(frame)
  }, [listRequiredWidth])

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
  const requiredWidth = listRequiredWidth ?? maxSplitListWidth
  const listWidth =
    effectiveView === 'split'
      ? (dragWidth ?? resolveListPaneWidth(requiredWidth, listSlack, width))
      : effectiveView === 'list'
        ? space
        : 0
  const panelWidth =
    effectiveView === 'split'
      ? panelWide
        ? Math.max(listWidth, Math.min(PANEL_WIDE_WIDTH, width))
        : listWidth
      : Math.min(panelWide ? PANEL_WIDE_WIDTH : PANEL_WIDTH, width)
  const dividerMovable = maxSplitListWidth > MIN_LIST_PANE_WIDTH

  const changeView = (next: FarmView) => {
    if (next !== view) onViewChange(next)
  }

  const placeDivider = (next: number) => {
    if (!dividerMovable) return null
    if (next < MIN_LIST_PANE_WIDTH - SPLIT_SNAP_TOLERANCE) {
      changeView('map')
      return null
    }
    if (next > maxSplitListWidth + SPLIT_SNAP_TOLERANCE) {
      changeView('list')
      return null
    }
    changeView('split')
    return snapListPaneWidth(next, width)
  }

  const dragListWidth = (next: number) => setDragWidth(placeDivider(next))

  const endDrag = () => {
    if (dragWidth === null) return
    onListSlackChange((dragWidth - requiredWidth) / space)
    setDragWidth(null)
  }

  const applyListWidth = (next: number) => {
    const placed = placeDivider(next)
    if (placed !== null) onListSlackChange((placed - requiredWidth) / space)
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
    if (!dividerMovable) return
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
    onListSlackChange(DEFAULT_LIST_SLACK)
    changeView('split')
  }

  const handleDraggingChange = useCallback(
    (dragging: boolean) => setIsDragging(dragging),
    [],
  )

  const showList = effectiveView !== 'map'
  const showMap = effectiveView !== 'list'
  const panelFromRight = effectiveView !== 'split'
  const dividerCovered =
    renderPanel !== undefined &&
    !isDragging &&
    !panelFromRight &&
    listWidth + SPLIT_DIVIDER_WIDTH <= panelWidth

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-80 min-w-0 flex-1 items-stretch"
    >
      {innerWidth === null ? null : (
        <>
          {showList ? (
            <div
              className={cn(
                'relative flex min-h-0 min-w-0 flex-col @container',
                effectiveView === 'split' ? 'shrink-0' : 'flex-1',
                widthSettled && !isDragging && 'pane-width-transition',
              )}
              style={
                effectiveView === 'split' ? { width: listWidth } : undefined
              }
            >
              <div className="min-h-0 flex-1 overflow-y-auto">
                {list({ width: listWidth })}
              </div>
            </div>
          ) : null}
          {!splitAvailable ? null : dividerCovered ? (
            <div aria-hidden="true" className="w-2 shrink-0 self-stretch" />
          ) : (
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
          )}
          {renderPanel ? (
            <div
              className={cn(
                'absolute inset-y-0 z-30 flex min-h-0 flex-col bg-card shadow-xl',
                panelFromRight
                  ? 'panel-slide-in-right right-0 border-l'
                  : 'panel-slide-in left-0 border-r',
                !isDragging && 'pane-width-transition',
              )}
              style={{ width: panelWidth }}
            >
              {renderPanel({
                listBehind: showList,
                mapVisible: showMap,
              })}
            </div>
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
