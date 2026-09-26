import { isValidElement, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export const AppTooltip = ({
  content,
  children,
  side,
}: {
  content: ReactNode
  children: ReactNode
  side?: ComponentProps<typeof TooltipContent>['side']
}) => {
  if (content === null || content === undefined || content === '') return children

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {isValidElement(children) ? children : <span className="inline-flex">{children}</span>}
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} className="max-w-64">{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export const TruncatedTooltip = ({
  content,
  children,
  className,
}: {
  content: ReactNode
  children: ReactNode
  className?: string
}) => {
  const ref = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setClipped(element.scrollWidth > element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [children])

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span ref={ref} className={className} tabIndex={clipped ? 0 : undefined}>
            {children}
          </span>
        </TooltipTrigger>
        {clipped && content != null && content !== '' ? (
          <TooltipContent sideOffset={6} className="max-w-64">{content}</TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  )
}
