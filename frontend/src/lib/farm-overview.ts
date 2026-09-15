import type { Farm, FieldRecord } from '@/api/types'
import {
  describeSeparateQuotas,
  formatNumber,
  formatQuotaAmount,
  quotaPercent,
  resolveFarmQuota,
  type FarmQuota,
  type FieldTotals,
  type QuotaStatusLevel,
} from '@/lib/field-domain'

export type FarmOverview = {
  totals: FieldTotals | null
  level: QuotaStatusLevel | null
  quotaPct: number | null
  quota: FarmQuota | null
}

export const summarizeFarmFields = (
  fields: FieldRecord[] | undefined,
): FarmOverview => {
  if (!fields) {
    return { totals: null, level: null, quotaPct: null, quota: null }
  }
  const quota = resolveFarmQuota(fields, false)
  const { totals, quotaKgN } = quota
  if (fields.length === 0) {
    return { totals, level: null, quotaPct: null, quota: null }
  }
  const percent =
    quotaKgN === null ? null : quotaPercent(totals.nLoad, quotaKgN)
  return {
    totals,
    level: quota.level,
    quotaPct: percent === null ? null : Math.min(100, Math.round(percent)),
    quota,
  }
}

export const describeFarmQuota = ({
  totals,
  quotaPct,
  quota,
}: FarmOverview): string => {
  if (!totals) return ''
  if (quota && quota.quotaKgN === null) return describeSeparateQuotas(quota)
  return quotaPct !== null
    ? `${formatQuotaAmount(totals.nLoad, totals.nLoadQuotaKgN)} · ${quotaPct} %`
    : `${formatNumber(totals.nLoad)} kg N udledt`
}

export const sortFarms = (
  farms: Farm[],
  lastOpened: Record<string, number>,
): Farm[] =>
  [...farms].sort(
    (left, right) =>
      (lastOpened[right.id] ?? 0) - (lastOpened[left.id] ?? 0) ||
      left.name.localeCompare(right.name, 'da-DK'),
  )

export const latestOpenedFarm = (
  farms: Farm[],
  lastOpened: Record<string, number>,
): Farm | null => {
  if (farms.length < 2) return null
  let latest: Farm | null = null
  for (const farm of farms) {
    const openedAt = lastOpened[farm.id] ?? 0
    if (openedAt > 0 && openedAt > (latest ? lastOpened[latest.id] : 0)) {
      latest = farm
    }
  }
  return latest
}
