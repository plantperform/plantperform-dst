import type { Farm, FieldRecord } from '@/api/types'
import {
  QUOTA_STATUS_LABELS,
  quotaPercent,
  resolveFarmQuota,
  type CatchmentQuota,
  type FarmQuota,
  type FieldTotals,
  type QuotaStatusLevel,
} from '@/lib/field-domain'

export type FarmOverview = {
  totals: FieldTotals | null
  level: QuotaStatusLevel | null
  quota: FarmQuota | null
}

export const summarizeFarmFields = (
  fields: FieldRecord[] | null,
): FarmOverview => {
  if (!fields) return { totals: null, level: null, quota: null }
  const quota = resolveFarmQuota(fields, false)
  if (fields.length === 0) {
    return { totals: quota.totals, level: null, quota: null }
  }
  return { totals: quota.totals, level: quota.level, quota }
}

export const formatFarmCount = (count: number) =>
  `${count} ${count === 1 ? 'bedrift' : 'bedrifter'}`

const pressuredCatchments = ({
  level,
  quota,
}: FarmOverview): CatchmentQuota[] =>
  quota && (level === 'over' || level === 'near')
    ? quota.catchments.filter((catchment) => catchment.level === level)
    : []

export const farmStatusCatchmentId = (
  overview: FarmOverview,
): number | null => {
  const catchments = pressuredCatchments(overview)
  return catchments.length === 1 ? catchments[0].catchmentId : null
}

export const describeFarmQuotaStatus = (
  overview: FarmOverview,
  catchmentLabel: (catchmentId: number) => string,
): string => {
  const { totals, level } = overview
  if (!totals) return 'Kunne ikke hente tal'
  if (level === null) return 'Ingen marker endnu'
  const catchments = pressuredCatchments(overview)
  const where =
    catchments.length === 1
      ? catchmentLabel(catchments[0].catchmentId)
      : catchments.length > 1
        ? `${catchments.length} oplande`
        : null
  if (level === 'over') return where ? `${where} over kvoten` : 'Over kvoten'
  if (level === 'near') {
    return where ? `Tæt på kvoten i ${where}` : 'Tæt på kvoten'
  }
  return level === 'ok' ? 'Under kvoten' : QUOTA_STATUS_LABELS[level]
}

const QUOTA_PRESSURE_ORDER: (QuotaStatusLevel | null)[] = ['over', 'near', 'ok']

const quotaPressureRank = ({ totals, level }: FarmOverview): number => {
  if (totals?.fieldCount === 0) return QUOTA_PRESSURE_ORDER.length + 1
  const rank = QUOTA_PRESSURE_ORDER.indexOf(level)
  return rank === -1 ? QUOTA_PRESSURE_ORDER.length : rank
}

const highestQuotaShare = ({ quota }: FarmOverview): number => {
  if (!quota) return 0
  const totals =
    quota.catchments.length > 0
      ? quota.catchments.map((catchment) => catchment.totals)
      : [quota.totals]
  return Math.max(
    ...totals.map(
      ({ nLoad, nLoadQuotaKgN }) => quotaPercent(nLoad, nLoadQuotaKgN) ?? 0,
    ),
  )
}

const compareNames = (left: Farm, right: Farm): number =>
  left.name.localeCompare(right.name, 'da-DK')

export const sortFarmsByName = (farms: Farm[]): Farm[] =>
  [...farms].sort(compareNames)

export const sortFarmsByQuotaPressure = (
  farms: Farm[],
  overviews: Partial<Record<string, FarmOverview>>,
): Farm[] => {
  const ranked = farms.flatMap((farm) => {
    const overview = overviews[farm.id]
    return overview ? [{ farm, overview }] : []
  })
  if (ranked.length < farms.length) return sortFarmsByName(farms)
  return ranked
    .sort(
      (left, right) =>
        quotaPressureRank(left.overview) - quotaPressureRank(right.overview) ||
        highestQuotaShare(right.overview) - highestQuotaShare(left.overview) ||
        compareNames(left.farm, right.farm),
    )
    .map(({ farm }) => farm)
}

export const farmMatchesSearch = (farm: Farm, searchText: string): boolean => {
  const search = searchText.trim().toLowerCase()
  if (!search) return true
  return (
    [farm.name, farm.ownerName].some((value) =>
      value.toLowerCase().includes(search),
    ) || (farm.cvr ?? '').includes(search.replace(/\s/g, ''))
  )
}

const DAY_MS = 86_400_000

const startOfDay = (timestamp: number): number =>
  new Date(timestamp).setHours(0, 0, 0, 0)

export const describeLastOpened = (
  openedAt: number | undefined,
  now = Date.now(),
): string => {
  if (openedAt === undefined) return 'ny'
  const days = Math.max(
    0,
    Math.round((startOfDay(now) - startOfDay(openedAt)) / DAY_MS),
  )
  if (days === 0) return 'i dag'
  if (days === 1) return 'i går'
  if (days < 7) return `${days} dage siden`
  if (days < 14) return 'sidste uge'
  if (days < 60) return `${Math.floor(days / 7)} uger siden`
  return `${Math.floor(days / 30)} måneder siden`
}
