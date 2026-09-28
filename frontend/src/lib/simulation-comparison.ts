import type {
  FieldRecord,
  FieldYearValues,
  OptimizationConstraints,
  Simulation,
} from '@/api/types'
import {
  formatFieldCount,
  formatWholeNumber,
  groupFieldsByCatchment,
  isFieldCalculated,
  quotaPercent,
  quotaStatusLevel,
  REAL_HISTORY_START_CALENDAR_YEAR,
  ROTATION_CALENDAR_YEARS,
  ROTATION_START_CALENDAR_YEAR,
  type CatchmentTotalsByYear,
  type CatchmentYearTotals,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import {
  summarizeCatchmentYearStatuses,
  type CatchmentYearStatus,
} from '@/lib/simulation-overview'

export const MAX_COMPARED_SIMULATIONS = 3

export const parseComparisonIds = (value: string | null): string[] =>
  (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')

export const resolveComparisonIds = (
  requested: string[],
  selectable: ReadonlySet<string>,
): string[] => {
  const ids: string[] = []
  for (const id of requested) {
    if (ids.length === MAX_COMPARED_SIMULATIONS) break
    if (selectable.has(id) && !ids.includes(id)) ids.push(id)
  }
  return ids
}

const createdAtTime = (simulation: Pick<Simulation, 'createdAt'>): number =>
  Date.parse(simulation.createdAt) || 0

export const defaultComparisonIds = (
  simulations: Pick<Simulation, 'id' | 'createdAt'>[],
  selectable: ReadonlySet<string>,
): string[] =>
  simulations
    .filter((simulation) => selectable.has(simulation.id))
    .sort((left, right) => createdAtTime(right) - createdAtTime(left))
    .slice(0, MAX_COMPARED_SIMULATIONS)
    .map((simulation) => simulation.id)

export const toggleComparisonId = (ids: string[], id: string): string[] => {
  if (ids.includes(id)) return ids.filter((selected) => selected !== id)
  return ids.length < MAX_COMPARED_SIMULATIONS ? [...ids, id] : ids
}

export type ComparisonAvailability =
  | { kind: 'ready' }
  | { kind: 'uncalculated' }
  | { kind: 'partial'; missingCount: number }

export const comparisonAvailability = (
  fields: FieldRecord[],
): ComparisonAvailability => {
  const missingCount = fields.filter(
    (field) => !isFieldCalculated(field, true),
  ).length
  if (missingCount === fields.length) return { kind: 'uncalculated' }
  if (missingCount > 0) return { kind: 'partial', missingCount }
  return { kind: 'ready' }
}

export const describeComparisonAvailability = (
  availability: ComparisonAvailability,
): string | null => {
  if (availability.kind === 'uncalculated') return 'Ikke beregnet'
  if (availability.kind === 'partial') {
    return `${formatFieldCount(availability.missingCount)} ikke beregnet`
  }
  return null
}

export type BestDirection = 'highest' | 'lowest'

export const bestColumnIndex = (
  values: (number | null)[],
  direction: BestDirection,
  format: (value: number) => string,
): number | null => {
  const present = values.flatMap((value, index) =>
    value === null ? [] : [{ value, index }],
  )
  if (present.length < 2) return null
  const best = present.reduce((winner, candidate) => {
    const better =
      direction === 'highest'
        ? candidate.value > winner.value
        : candidate.value < winner.value
    return better ? candidate : winner
  })
  const bestText = format(best.value)
  const ties = present.filter((entry) => format(entry.value) === bestText)
  return ties.length === 1 ? best.index : null
}

export const formatKgN = (value: number): string =>
  `${formatWholeNumber(value)} kg N`

export const formatFeedUnits = (value: number): string =>
  `${formatWholeNumber(value)} FE`

export const describeFeedUnitRequirement = ({
  minFeedUnits,
  maxFeedUnits,
}: Pick<OptimizationConstraints, 'minFeedUnits' | 'maxFeedUnits'>):
  | string
  | null => {
  if (minFeedUnits !== null && maxFeedUnits !== null) {
    return `Krav ${formatWholeNumber(minFeedUnits)}-${formatFeedUnits(maxFeedUnits)}`
  }
  if (minFeedUnits !== null) {
    return `Krav mindst ${formatFeedUnits(minFeedUnits)}`
  }
  if (maxFeedUnits !== null) {
    return `Krav højst ${formatFeedUnits(maxFeedUnits)}`
  }
  return null
}

export type FeedUnitRequirementPlacement = {
  label: string | null
  cells: (string | null)[]
}

export const placeFeedUnitRequirements = (
  requirements: (string | null)[],
): FeedUnitRequirementPlacement => {
  const distinct = [
    ...new Set(
      requirements.filter(
        (requirement): requirement is string => requirement !== null,
      ),
    ),
  ]
  if (distinct.length > 1) return { label: null, cells: requirements }
  return {
    label: distinct.length === 1 ? distinct[0] : null,
    cells: requirements.map(() => null),
  }
}

const HISTORY_YEAR_OFFSET =
  ROTATION_START_CALENDAR_YEAR - REAL_HISTORY_START_CALENDAR_YEAR

export const alignCatchmentYears = (
  totalsByYear: CatchmentTotalsByYear,
  history: boolean,
): CatchmentTotalsByYear => {
  const aligned: CatchmentTotalsByYear = new Map()
  for (const [catchmentId, byYear] of totalsByYear) {
    const years: Record<number, CatchmentYearTotals> = {}
    for (const [year, totals] of Object.entries(byYear)) {
      const calendarYear = history
        ? Number(year) + HISTORY_YEAR_OFFSET
        : ROTATION_START_CALENDAR_YEAR + Number(year) - 1
      years[calendarYear] = totals
    }
    aligned.set(catchmentId, years)
  }
  return aligned
}

export type CatchmentYearQuota = {
  year: number
  quotaPct: number | null
  level: QuotaStatusLevel
}

export type CatchmentAverage = {
  nLoadKg: number
  quotaPct: number
}

export type CatchmentComparison = {
  status: CatchmentYearStatus
  complete: boolean
  average: CatchmentAverage | null
  years: CatchmentYearQuota[]
}

export const summarizeCatchmentComparison = (
  catchmentId: number,
  totalsByYear: CatchmentTotalsByYear,
  partialQuotaKgN?: number,
): CatchmentComparison | null => {
  const byYear: Record<number, CatchmentYearTotals> =
    totalsByYear.get(catchmentId) ?? {}
  const yearQuotaKgN = (year: number): number =>
    byYear[year] === undefined ? 0 : (partialQuotaKgN ?? byYear[year].quotaKgN)
  const quotaYears = ROTATION_CALENDAR_YEARS.filter(
    (year) => yearQuotaKgN(year) > 0,
  )
  if (quotaYears.length === 0 && partialQuotaKgN === undefined) return null
  const single: CatchmentTotalsByYear = new Map([[catchmentId, byYear]])
  const [status] = summarizeCatchmentYearStatuses(
    single,
    true,
    partialQuotaKgN === undefined
      ? undefined
      : new Map([[catchmentId, partialQuotaKgN]]),
  )
  const nLoadKg = quotaYears.reduce(
    (sum, year) => sum + byYear[year].nLoadKg,
    0,
  )
  const quotaKgN = quotaYears.reduce((sum, year) => sum + yearQuotaKgN(year), 0)
  return {
    status,
    complete: partialQuotaKgN === undefined,
    average:
      quotaYears.length === 0
        ? null
        : {
            nLoadKg: nLoadKg / quotaYears.length,
            quotaPct: quotaPercent(nLoadKg, quotaKgN) ?? 0,
          },
    years: ROTATION_CALENDAR_YEARS.map((year) => {
      const yearNLoadKg = byYear[year]?.nLoadKg ?? 0
      return {
        year,
        quotaPct: quotaPercent(yearNLoadKg, yearQuotaKgN(year)),
        level: quotaStatusLevel(yearNLoadKg, yearQuotaKgN(year), true),
      }
    }),
  }
}

export type ComparedCatchment = {
  catchmentId: number
  label: string
}

export const listComparedCatchments = (
  columns: {
    catchments: CatchmentTotalsByYear | undefined
    partialQuotas: ReadonlyMap<number, number>
  }[],
  labelOf: (catchmentId: number) => string,
): ComparedCatchment[] => {
  const catchmentIds = new Set<number>()
  for (const { catchments, partialQuotas } of columns) {
    for (const catchmentId of partialQuotas.keys())
      catchmentIds.add(catchmentId)
    if (!catchments) continue
    for (const [catchmentId, byYear] of catchments) {
      if (catchmentId === null) continue
      if (Object.values(byYear).some((totals) => totals.quotaKgN > 0)) {
        catchmentIds.add(catchmentId)
      }
    }
  }
  return [...catchmentIds]
    .map((catchmentId) => ({ catchmentId, label: labelOf(catchmentId) }))
    .sort((left, right) => left.label.localeCompare(right.label, 'da-DK'))
}

export const hasMissingYearValues = (
  fields: FieldRecord[],
  yearsByFieldId: FieldYearValues,
  history: boolean,
): boolean =>
  fields.some(
    (field) =>
      isFieldCalculated(field, !history) && !(field.id in yearsByFieldId),
  )

export const QUOTA_BAR_CEILING_PCT = 130

export const quotaBarShare = (quotaPct: number): number =>
  (Math.min(Math.max(quotaPct, 0), QUOTA_BAR_CEILING_PCT) * 100) /
  QUOTA_BAR_CEILING_PCT

export const catchmentQuotas = (fields: FieldRecord[]): Map<number, number> =>
  new Map(
    groupFieldsByCatchment(fields, false).flatMap(({ catchmentId, totals }) =>
      catchmentId !== null && totals.nLoadQuotaKgN > 0
        ? [[catchmentId, totals.nLoadQuotaKgN] as const]
        : [],
    ),
  )
