import { useEffect, useRef, useState } from 'react'

import { SPLIT_STEP } from '@/components/farm/split-layout'
import { cn } from '@/lib/utils'

type SplitDividerProps = {
  listWidth: number
  minListWidth: number
  maxListWidth: number
  onDrag: (listWidth: number) => void
  onDragEnd: () => void
  onStep: (delta: number) => void
  onJump: (edge: 'start' | 'end') => void
  onReset: () => void
  onDraggingChange: (dragging: boolean) => void
}

export const SplitDivider = ({
  listWidth,
  minListWidth,
  maxListWidth,
  onDrag,
  onDragEnd,
  onStep,
  onJump,
  onReset,
  onDraggingChange,
}: SplitDividerProps) => {
  const [isDragging, setIsDragging] = useState(false)
  const grabOffsetRef = useRef(0)

  useEffect(() => {
    if (!isDragging) return

    onDraggingChange(true)
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      onDraggingChange(false)
    }
  }, [isDragging, onDraggingChange])

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    grabOffsetRef.current = event.clientX - handle.getBoundingClientRect().left
    handle.setPointerCapture(event.pointerId)
    handle.focus()
    setIsDragging(true)
  }

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const left =
      event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0
    onDrag(event.clientX - grabOffsetRef.current - left)
  }

  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDragging(false)
    onDragEnd()
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onStep(-SPLIT_STEP)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onStep(SPLIT_STEP)
    } else if (event.key === 'Home') {
      event.preventDefault()
      onJump('start')
    } else if (event.key === 'End') {
      event.preventDefault()
      onJump('end')
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Skillelinje mellem liste og kort"
      aria-valuenow={Math.round(listWidth)}
      aria-valuemin={minListWidth}
      aria-valuemax={maxListWidth}
      tabIndex={0}
      className={cn(
        'group relative z-20 flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center self-stretch transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isDragging ? 'bg-primary' : 'bg-transparent hover:bg-primary/40',
      )}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onDoubleClick={onReset}
      onKeyDown={resizeWithKeyboard}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border"
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none relative h-8 w-1 rounded-full bg-border transition-colors group-hover:bg-primary',
          isDragging && 'bg-primary-foreground',
        )}
      />
    </div>
  )
}
