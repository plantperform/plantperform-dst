import type { ReactNode } from 'react'

import type { QuotaStatusLevel } from '@/lib/field-domain'

const QUOTA_STATUS_DOT_COLOR: Record<QuotaStatusLevel, string> = {
  ok: '#16a34a',
  near: '#d97706',
  over: '#c62020',
  uncalculated: '#9ca3af',
  noData: '#9ca3af',
  partial: '#9ca3af',
}

export type QuotaStatusBadge = {
  label: string
  bg: string
  border: string
  color: string
}

export const QuotaStatusIndicator = ({
  level,
  children,
  bold = false,
  badge,
}: {
  level: QuotaStatusLevel
  children: ReactNode
  bold?: boolean
  badge?: QuotaStatusBadge
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <span
      className="h-[9px] w-[9px] shrink-0 rounded-full"
      style={{ backgroundColor: QUOTA_STATUS_DOT_COLOR[level] }}
      aria-hidden="true"
    />
    <span className={bold ? 'font-semibold' : undefined}>{children}</span>
    {badge ? (
      <span
        className="rounded-full border px-2 py-0.5 text-xs"
        style={{
          backgroundColor: badge.bg,
          borderColor: badge.border,
          color: badge.color,
        }}
      >
        {badge.label}
      </span>
    ) : null}
  </div>
)
