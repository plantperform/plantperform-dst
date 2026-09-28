import type { ReactNode } from 'react'

import { QUOTA_STATUS_STYLES, type QuotaStatusLevel } from '@/lib/field-domain'
import {
  describeCatchmentYearStatus,
  type CatchmentYearStatus,
} from '@/lib/simulation-overview'
import { cn } from '@/lib/utils'

type QuotaStatusIndicatorProps = {
  level: QuotaStatusLevel
  children: ReactNode
  className?: string
}

export const QuotaStatusIndicator = ({
  level,
  children,
  className,
}: QuotaStatusIndicatorProps) => (
  <span className={cn('flex items-center gap-2 whitespace-nowrap', className)}>
    <span
      className={cn(
        'size-2 shrink-0 rounded-full',
        QUOTA_STATUS_STYLES[level].dot,
      )}
      aria-hidden="true"
    />
    <span>{children}</span>
  </span>
)

type CatchmentYearStatusIndicatorProps = {
  status: CatchmentYearStatus
  className?: string
}

export const CatchmentYearStatusIndicator = ({
  status,
  className,
}: CatchmentYearStatusIndicatorProps) => (
  <QuotaStatusIndicator
    level={status.level}
    className={cn(
      'gap-1.5 text-xs font-medium whitespace-normal',
      QUOTA_STATUS_STYLES[status.level].text,
      className,
    )}
  >
    {describeCatchmentYearStatus(status)}
  </QuotaStatusIndicator>
)
