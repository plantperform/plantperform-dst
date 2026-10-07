import type { RegistryField } from '@/api/types'
import { BRAND_COLORS } from '@/lib/brand-colors'
import {
  formatFieldCount,
  formatHectares,
  formatWholeNumber,
} from '@/lib/field-domain'

export type LookupField = Pick<
  RegistryField,
  'catchmentId' | 'catchmentName' | 'areaHa' | 'nLoadQuotaKgN' | 'quotaEligible'
>

type CatchmentSums = {
  catchmentId: number | null
  catchmentName: string | null
  fieldCount: number
  areaHa: number
  quotaKgN: number
}

export type LookupCatchment = CatchmentSums & { color: string }

export type LookupSummary = {
  fieldCount: number
  areaHa: number
  quotaKgN: number
  catchmentCount: number
  catchments: LookupCatchment[]
}

const CATCHMENT_COLORS = [
  BRAND_COLORS.water,
  BRAND_COLORS.waterTertiary,
  BRAND_COLORS.forestTertiary,
  BRAND_COLORS.soil,
  BRAND_COLORS.berry,
  BRAND_COLORS.carrot,
]

const NO_CATCHMENT_COLOR = BRAND_COLORS.sand

const compareCatchments = (left: CatchmentSums, right: CatchmentSums) => {
  if (left.catchmentId === null) return 1
  if (right.catchmentId === null) return -1
  return (left.catchmentName ?? '').localeCompare(
    right.catchmentName ?? '',
    'da',
  )
}

export const summarizeLookup = (fields: LookupField[]): LookupSummary => {
  const byCatchment = new Map<number | null, CatchmentSums>()
  for (const field of fields) {
    const sums = byCatchment.get(field.catchmentId) ?? {
      catchmentId: field.catchmentId,
      catchmentName: field.catchmentName,
      fieldCount: 0,
      areaHa: 0,
      quotaKgN: 0,
    }
    sums.fieldCount += 1
    sums.areaHa += field.areaHa
    if (field.quotaEligible) sums.quotaKgN += field.nLoadQuotaKgN
    byCatchment.set(field.catchmentId, sums)
  }
  const catchments = [...byCatchment.values()]
    .sort(compareCatchments)
    .map((sums, index) => ({
      ...sums,
      color:
        sums.catchmentId === null
          ? NO_CATCHMENT_COLOR
          : CATCHMENT_COLORS[index % CATCHMENT_COLORS.length],
    }))

  return {
    fieldCount: fields.length,
    areaHa: catchments.reduce((sum, catchment) => sum + catchment.areaHa, 0),
    quotaKgN: catchments.reduce(
      (sum, catchment) => sum + catchment.quotaKgN,
      0,
    ),
    catchmentCount: catchments.filter(
      (catchment) => catchment.catchmentId !== null,
    ).length,
    catchments,
  }
}

const describeCatchmentCount = (count: number) => {
  if (count === 0) return 'uden kystvandopland'
  return count === 1 ? 'i et kystvandopland' : `i ${count} kystvandoplande`
}

export const describeLookup = (summary: LookupSummary) =>
  `Vi fandt ${formatFieldCount(summary.fieldCount)} på ${formatHectares(summary.areaHa)} ha ${describeCatchmentCount(summary.catchmentCount)}`

export const describeLookupQuota = (summary: LookupSummary) => {
  const quota = `Samlet kvote ${formatWholeNumber(summary.quotaKgN)} kg N pr. år`
  return summary.catchmentCount > 1
    ? `${quota}, fordelt på ${summary.catchmentCount} lofter der hver skal holdes.`
    : `${quota}.`
}
