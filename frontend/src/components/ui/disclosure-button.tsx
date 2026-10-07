import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type DisclosureButtonProps = {
  open: boolean
  onToggle: () => void
  label: ReactNode
  'aria-controls'?: string
  hint?: ReactNode
  hintAlign?: 'start' | 'end'
  trailing?: ReactNode
  className?: string
}

export const DisclosureButton = ({
  open,
  onToggle,
  label,
  'aria-controls': ariaControls,
  hint,
  hintAlign = 'start',
  trailing,
  className,
}: DisclosureButtonProps) => (
  <button
    type="button"
    aria-expanded={open}
    aria-controls={ariaControls}
    onClick={onToggle}
    className={cn(
      'flex items-center gap-2 rounded-md text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
  >
    <ChevronRight
      className={cn(
        'size-4 shrink-0 text-muted-foreground motion-safe:transition-transform',
        open && 'rotate-90',
      )}
      aria-hidden="true"
    />
    <span>{label}</span>
    {!open && hint ? (
      <span
        className={cn(
          'text-xs font-normal text-muted-foreground',
          hintAlign === 'end' && 'ml-auto',
        )}
      >
        {hint}
      </span>
    ) : null}
    {trailing !== undefined ? (
      <span className="ml-auto shrink-0">{trailing}</span>
    ) : null}
  </button>
)
