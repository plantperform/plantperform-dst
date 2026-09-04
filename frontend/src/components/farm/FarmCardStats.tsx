import { useFarmFields } from '@/api/hooks'
import type { Farm } from '@/api/types'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import {
  aggregateQuotaStatusLevel,
  computeFarmQuotaSummary,
  formatFieldCount,
  formatNumber,
} from '@/lib/field-domain'

export const FarmCardStats = ({ farm }: { farm: Farm }) => {
  const { data: fields, error, isLoading } = useFarmFields(farm.id)

  if (isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        <div className="h-4 w-1/2 motion-safe:animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 motion-safe:animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (error || !fields) return null

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">Ingen marker endnu</p>
  }

  const totalAreaHa = fields.reduce((sum, field) => sum + field.areaHa, 0)
  const summary = computeFarmQuotaSummary(fields, false)
  const level = aggregateQuotaStatusLevel(
    summary.totalNLoad,
    summary.quota.quotaKgn,
    summary.calculatedCount,
    fields.length,
  )

  return (
    <div className="space-y-1.5 text-sm text-muted-foreground">
      <p>
        {formatFieldCount(fields.length)} · {formatNumber(totalAreaHa)} ha
      </p>
      {summary.quota.quotaKgn > 0 ? (
        <QuotaStatusIndicator level={level}>
          {formatNumber(summary.totalNLoad)} af{' '}
          {formatNumber(summary.quota.quotaKgn)} kg N
        </QuotaStatusIndicator>
      ) : null}
    </div>
  )
}
