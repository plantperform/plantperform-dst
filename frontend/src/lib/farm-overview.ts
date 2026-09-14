import type { Farm, FieldRecord } from '@/api/types'
import {
  computeFieldTotals,
  formatNumber,
  totalsQuotaStatusLevel,
  type FieldTotals,
  type QuotaStatusLevel,
} from '@/lib/field-domain'

export const FARM_STATUS_LABELS: Record<QuotaStatusLevel, string> = {
  ok: 'Under kvote',
  near: 'Tæt på kvote',
  over: 'Over kvote',
  uncalculated: 'Ikke beregnet',
  noData: 'Ingen kvote',
  partial: 'Delvist beregnet',
}

export type FarmOverview = {
  totals: FieldTotals | null
  level: QuotaStatusLevel | null
  quotaPct: number | null
}

export const summarizeFarmFields = (
  fields: FieldRecord[] | undefined,
): FarmOverview => {
  if (!fields) return { totals: null, level: null, quotaPct: null }
  const totals = computeFieldTotals(fields, false)
  if (fields.length === 0) return { totals, level: null, quotaPct: null }
  return {
    totals,
    level: totalsQuotaStatusLevel(totals),
    quotaPct:
      totals.udledningskvoteMarkKgn > 0
        ? Math.min(
            100,
            Math.round((totals.nLoad / totals.udledningskvoteMarkKgn) * 100),
          )
        : null,
  }
}

export const describeFarmQuota = (
  totals: FieldTotals,
  quotaPct: number | null,
): string =>
  quotaPct !== null
    ? `${formatNumber(totals.nLoad)} af ${formatNumber(totals.udledningskvoteMarkKgn)} kg N · ${quotaPct} %`
    : `${formatNumber(totals.nLoad)} kg N udledt`

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
