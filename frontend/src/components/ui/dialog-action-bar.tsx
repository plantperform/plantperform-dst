import type * as React from 'react'

import { cn } from '@/lib/utils'

type DialogActionBarProps = {
  // Right-aligned actions, such as Annuller and the submit button.
  actions: React.ReactNode
  // Left-aligned secondary action, such as Start forfra.
  secondaryAction?: React.ReactNode
  // Shown next to the actions, for example which fields need fixing.
  message?: React.ReactNode
  className?: string
}

export const DialogActionBar = ({
  actions,
  secondaryAction,
  message,
  className,
}: DialogActionBarProps) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-6 py-4',
      className,
    )}
  >
    {secondaryAction}
    {/* Next to the actions it explains. Always mounted, never display:none,
        so screen readers announce messages as they appear. */}
    <div aria-live="polite" className="ml-auto min-w-0 text-right text-xs">
      {message}
    </div>
    <div className="flex items-center gap-2">{actions}</div>
  </div>
)
