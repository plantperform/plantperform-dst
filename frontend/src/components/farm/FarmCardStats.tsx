import { useFarmFields } from '@/api/hooks'
import type { Farm } from '@/api/types'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import {
  computeFieldTotals,
  formatFieldCount,
  formatNumber,
  totalsQuotaStatusLevel,
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

  const totals = computeFieldTotals(fields, false)
  const level = totalsQuotaStatusLevel(totals)

  return (
    <div className="space-y-1.5 text-sm text-muted-foreground">
      <p>
        {formatFieldCount(totals.fieldCount)} · {formatNumber(totals.areaHa)} ha
      </p>
      {totals.udledningskvoteMarkKgn > 0 ? (
        <QuotaStatusIndicator level={level}>
          {formatNumber(totals.nLoad)} af{' '}
          {formatNumber(totals.udledningskvoteMarkKgn)} kg N
        </QuotaStatusIndicator>
      ) : null}
    </div>
  )
}
