import { useEffect, useRef, useState } from 'react'

import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_STEP,
} from '@/components/farm/sidebar-width'

type SidebarResizeHandleProps = {
  width: number
  onWidthChange: (width: number) => void
}

/**
 * Drag handle on the sidebar's right edge. Keyboard users can focus it and
 * resize with the arrow keys.
 */
export const SidebarResizeHandle = ({
  width,
  onWidthChange,
}: SidebarResizeHandleProps) => {
  const [isDragging, setIsDragging] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isDragging) return

    const resize = (event: PointerEvent) => {
      const left = handleRef.current?.parentElement?.getBoundingClientRect().left
      onWidthChange(event.clientX - (left ?? 0))
    }
    const stop = () => setIsDragging(false)

    document.addEventListener('pointermove', resize)
    document.addEventListener('pointerup', stop)
    // The pointer regularly leaves the handle while dragging, so the cursor is
    // held on the body instead of the handle itself.
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('pointermove', resize)
      document.removeEventListener('pointerup', stop)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isDragging, onWidthChange])

  const resizeWithKeyboard = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onWidthChange(width - SIDEBAR_WIDTH_STEP)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      onWidthChange(width + SIDEBAR_WIDTH_STEP)
    }
  }

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="Justér sidebarens bredde"
      aria-valuenow={width}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      tabIndex={0}
      className={`hidden w-1 shrink-0 cursor-col-resize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:block ${
        isDragging ? 'bg-primary' : 'bg-transparent hover:bg-primary/40'
      }`}
      onPointerDown={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onKeyDown={resizeWithKeyboard}
    />
  )
}
