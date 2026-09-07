import type { ReactNode } from 'react'

import { QUOTA_STATUS_STYLES, type QuotaStatusLevel } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

type QuotaStatusIndicatorProps = {
  level: QuotaStatusLevel
  children: ReactNode
  badge?: boolean
  className?: string
}

export const QuotaStatusIndicator = ({
  level,
  children,
  badge = false,
  className,
}: QuotaStatusIndicatorProps) => {
  const style = QUOTA_STATUS_STYLES[level]
  return (
    <span className={cn('flex flex-wrap items-center gap-2', className)}>
      <span
        className={cn('size-2 shrink-0 rounded-full', style.dot)}
        aria-hidden="true"
      />
      <span>{children}</span>
      {badge && style.badgeLabel ? (
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs font-normal',
            style.surface,
            style.text,
          )}
        >
          {style.badgeLabel}
        </span>
      ) : null}
    </span>
  )
}
