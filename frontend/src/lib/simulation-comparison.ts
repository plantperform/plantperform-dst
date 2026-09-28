import type {
  FieldRecord,
  FieldYearValues,
  OptimizationConstraints,
  Simulation,
} from '@/api/types'
import {
  formatCompactDkk,
  formatFieldCount,
  formatSigned,
  formatWholeNumber,
  groupFieldsByCatchment,
  isFieldCalculated,
  NUM_ROTATION_YEARS,
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
  describeYears,
  summarizeCatchmentYearStatuses,
  type CatchmentYearStatus,
} from '@/lib/simulation-overview'

export const MAX_COMPARED_SIMULATIONS = 3

export const COMPARISON_PERIOD = `${ROTATION_START_CALENDAR_YEAR}-${ROTATION_START_CALENDAR_YEAR + NUM_ROTATION_YEARS - 1}`

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

export type ColumnQuotaSummary = {
  yearsOver: number
  catchmentsOver: number
}

export const summarizeColumnQuota = (
  catchmentIds: number[],
  totalsByYear: CatchmentTotalsByYear,
  partialQuotas: ReadonlyMap<number, number>,
): ColumnQuotaSummary => {
  let yearsOver = 0
  let catchmentsOver = 0
  for (const catchmentId of catchmentIds) {
    const over =
      summarizeCatchmentComparison(
        catchmentId,
        totalsByYear,
        partialQuotas.get(catchmentId),
      )?.status.overYears.length ?? 0
    yearsOver += over
    if (over > 0) catchmentsOver += 1
  }
  return { yearsOver, catchmentsOver }
}

export type BalanceCandidate = {
  db2: number | null
  yearsOver: number | null
}

const db2ForRanking = (candidate: BalanceCandidate): number =>
  candidate.db2 ?? Number.MIN_SAFE_INTEGER

export const rankByBalance = <T extends BalanceCandidate>(
  candidates: T[],
): T[] =>
  [...candidates].sort((left, right) => {
    if (left.yearsOver === null || right.yearsOver === null) {
      return Number(left.yearsOver === null) - Number(right.yearsOver === null)
    }
    return (
      left.yearsOver - right.yearsOver ||
      db2ForRanking(right) - db2ForRanking(left)
    )
  })

export type ComparisonSort = 'balance' | 'db2' | 'nLoad' | 'yearsOver'

export const COMPARISON_SORT_LABELS: Record<ComparisonSort, string> = {
  balance: 'bedste balance',
  db2: 'dækningsbidrag',
  nLoad: 'udledning',
  yearsOver: 'år over kvoten',
}

export type SortCandidate = BalanceCandidate & { nLoad: number | null }

const nullsLast = (left: number | null, right: number | null): number =>
  Number(left === null) - Number(right === null)

export const sortComparison = <T extends SortCandidate>(
  candidates: T[],
  sort: ComparisonSort,
): T[] => {
  const ranked = rankByBalance(candidates)
  if (sort === 'db2') {
    return ranked.sort(
      (left, right) =>
        nullsLast(left.db2, right.db2) || (right.db2 ?? 0) - (left.db2 ?? 0),
    )
  }
  if (sort === 'nLoad') {
    return ranked.sort(
      (left, right) =>
        nullsLast(left.nLoad, right.nLoad) ||
        (left.nLoad ?? 0) - (right.nLoad ?? 0),
    )
  }
  return ranked
}

export const formatDkkDelta = (difference: number, unitOf: number): string =>
  formatSigned(Math.round(difference), (value) =>
    formatCompactDkk(value, unitOf),
  )

export const formatYears = (count: number): string => `${count} år`

export const formatYearsDelta = (difference: number): string =>
  `${formatSigned(difference, String)} år`

const describeDb2AgainstHistory = (db2: number, historyDb2: number): string => {
  const difference = Math.round(db2 - historyDb2)
  if (difference === 0) return 'samme dækningsbidrag som afgrødehistorikken'
  return `${formatCompactDkk(Math.abs(difference), db2)} ${difference > 0 ? 'mere' : 'mindre'} end afgrødehistorikken`
}

export type ComparisonVerdictInput = {
  best: { title: string; db2: number | null; yearsOver: number | null }
  compliantCount: number
  simulationCount: number
  historyDb2: number | null
}

export const describeComparisonVerdict = ({
  best,
  compliantCount,
  simulationCount,
  historyDb2,
}: ComparisonVerdictInput): string | null => {
  if (best.yearsOver === null || simulationCount === 0) return null
  const db2 =
    best.db2 === null || historyDb2 === null
      ? null
      : describeDb2AgainstHistory(best.db2, historyDb2)
  if (best.yearsOver > 0) {
    return simulationCount === 1
      ? `${best.title} holder ikke kvoten i alle år: ${formatYears(best.yearsOver)} over kvoten.`
      : `Ingen simulering holder kvoten i alle år. ${best.title} kommer tættest på med ${formatYears(best.yearsOver)} over kvoten.`
  }
  if (simulationCount === 1) {
    return db2 === null
      ? `${best.title} holder kvoten i alle år og alle oplande.`
      : `${best.title} holder kvoten i alle år og alle oplande og giver ${db2}.`
  }
  const reason =
    compliantCount === 1
      ? 'eneste simulering under kvoten i alle år og alle oplande'
      : 'højeste dækningsbidrag af dem, der er under kvoten i alle år og alle oplande'
  return db2 === null
    ? `${best.title} giver den bedste balance: ${reason}.`
    : `${best.title} giver den bedste balance: ${reason}, og ${db2}.`
}

export const describeCatchmentYearsOver = (
  status: CatchmentYearStatus,
): string => {
  if (status.level === 'over') {
    return `over kvoten i ${describeYears(status.overYears)}`
  }
  if (status.level === 'partial') return 'delvist beregnet'
  if (status.level === 'noData') return 'ingen kvote'
  return 'under kvoten alle år'
}

export const shareOfMax = (value: number, max: number): number =>
  max > 0 ? (Math.max(value, 0) / max) * 100 : 0

export const curveCeilingPct = (values: (number | null)[]): number => {
  const highest = Math.max(
    0,
    ...values.filter((value): value is number => value !== null),
  )
  return Math.max(150, Math.ceil(highest / 10) * 10 + 10)
}

export const curveTopPct = (quotaPct: number, ceilingPct: number): number =>
  8 + (1 - quotaPct / ceilingPct) * 84

export const curveLeftPct = (index: number, count: number): number =>
  ((index + 0.5) / count) * 100

export const curveSegments = (
  values: (number | null)[],
  ceilingPct: number,
): string[] => {
  const segments: string[] = []
  let points: string[] = []
  values.forEach((value, index) => {
    if (value === null) {
      if (points.length > 0) segments.push(points.join(' '))
      points = []
      return
    }
    points.push(
      `${curveLeftPct(index, values.length)},${curveTopPct(value, ceilingPct)}`,
    )
  })
  if (points.length > 0) segments.push(points.join(' '))
  return segments
}

export const catchmentQuotas = (fields: FieldRecord[]): Map<number, number> =>
  new Map(
    groupFieldsByCatchment(fields, false).flatMap(({ catchmentId, totals }) =>
      catchmentId !== null && totals.nLoadQuotaKgN > 0
        ? [[catchmentId, totals.nLoadQuotaKgN] as const]
        : [],
    ),
  )

export type CurveTone = 'plain' | 'history' | 'best' | 'highlighted' | 'dimmed'

export const overlayCurveTone = (
  row: { key: string; history: boolean },
  bestKey: string | null,
  highlightedKey: string | null,
): CurveTone => {
  if (highlightedKey !== null) {
    return row.key === highlightedKey ? 'highlighted' : 'dimmed'
  }
  if (row.history) return 'history'
  return row.key === bestKey ? 'best' : 'plain'
}

export type CurveLegend = {
  text: string
  level: QuotaStatusLevel | null
}

export const describeCurveLegend = (
  years: CatchmentYearQuota[] | null,
  averagePct: number | null,
  hoveredYear: number | null,
): CurveLegend => {
  if (years === null) return { text: 'Ingen tal', level: null }
  if (hoveredYear === null) {
    return {
      text:
        averagePct === null
          ? 'Ingen tal'
          : `Gns. ${formatWholeNumber(averagePct)} % af kvoten`,
      level: null,
    }
  }
  const { year, quotaPct, level } = years[hoveredYear]
  return quotaPct === null
    ? { text: `${year} · ingen tal`, level: null }
    : { text: `${year} · ${formatWholeNumber(quotaPct)} %`, level }
}
