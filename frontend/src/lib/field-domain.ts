import type {
  FieldYearValues,
  Crop,
  FieldMeasures,
  FieldRecord,
  Measure,
  NamedRotation,
  RotationCandidateYearResult,
  RotationYear,
  YearlySummaryEntry,
} from '@/api/types'
import {
  cropGroupFor,
  shortCropName,
  type CropGroupDefinition,
} from '@/lib/crop-groups'

export const CROP_VALUES: Crop[] = [
  'CEREAL_WINTER',
  'CEREAL_SPRING',
  'CEREAL_LEGUME_MIX',
  'GRASS_CLOVER',
  'GRASS_SEED',
  'FALLOW',
  'BEET',
  'MAIZE_POTATO',
  'RAPE',
  'CEREAL_WINTER_AFTER_GRASS',
  'MAIZE_AFTER_GRASS',
  'CEREAL_SPRING_AFTER_GRASS',
  'CEREAL_VEG_BEAN',
]

const cropByRegistryId = new Map<number, Crop>([
  [1, 'CEREAL_WINTER'],
  [2, 'CEREAL_SPRING'],
  [3, 'CEREAL_LEGUME_MIX'],
  [4, 'GRASS_CLOVER'],
  [5, 'GRASS_SEED'],
  [6, 'FALLOW'],
  [7, 'BEET'],
  [8, 'MAIZE_POTATO'],
  [9, 'RAPE'],
  [10, 'CEREAL_WINTER_AFTER_GRASS'],
  [11, 'MAIZE_AFTER_GRASS'],
  [12, 'CEREAL_SPRING_AFTER_GRASS'],
  [13, 'CEREAL_VEG_BEAN'],
])

export const cropFromRegistryNumber = (value: number): Crop =>
  cropByRegistryId.get(value) ?? 'CEREAL_WINTER'

export const parseRegistryRotation = (value: string): Crop[] =>
  value
    .split('_')
    .map((part) => part.trim())
    .map((part) => {
      if (!part || !/^\d+$/.test(part)) return 'CEREAL_WINTER'
      return cropFromRegistryNumber(Number(part))
    })

export const formatCrop = (crop: Crop) => {
  const cropLabels: Record<Crop, string> = {
    CEREAL_WINTER: 'Vintersæd',
    CEREAL_SPRING: 'Vårsæd',
    CEREAL_LEGUME_MIX: 'Korn/bælgplante-blanding',
    GRASS_CLOVER: 'Græs/kløver',
    GRASS_SEED: 'Græsfrø',
    FALLOW: 'Brak',
    BEET: 'Roer',
    MAIZE_POTATO: 'Majs/kartofler',
    RAPE: 'Raps',
    CEREAL_WINTER_AFTER_GRASS: 'Vintersæd efter græs',
    MAIZE_AFTER_GRASS: 'Majs efter græs',
    CEREAL_SPRING_AFTER_GRASS: 'Vårsæd efter græs',
    CEREAL_VEG_BEAN: 'Korn, grøntsager, bønner',
  }

  return cropLabels[crop]
}

export const formatCropRotation = (rotation: Crop[]) =>
  rotation.length > 0 ? rotation.map(formatCrop).join(' - ') : 'Ukendt'

// Starting calendar year for the eight-year rotation. This must match
// candidate_evaluator.py::START_CALENDAR_YEAR in the backend. Position 1 is
// this year, position 2 is +1, etc. (position 1 maps to RotationYear index 0).
export const ROTATION_START_CALENDAR_YEAR = 2027
export const NUM_ROTATION_YEARS = 8
export const ROTATION_CALENDAR_YEARS = Array.from(
  { length: NUM_ROTATION_YEARS },
  (_, index) => ROTATION_START_CALENDAR_YEAR + index,
)
export const CURRENT_CALENDAR_YEAR = new Date().getFullYear()

export const yearNLoadKgHa = (
  leachingKgNHa: number,
  retention: number | null,
): number => leachingKgNHa * (1 - (retention ?? 0) / 100)

// Starting calendar year for the actual history in the "Aktuel" field overview
// (must match field_history_evaluator.py::REAL_HISTORY_END_YEAR - 7 in the
// backend). The eight positions are the field's actual 2019-2026 crops, not a
// forward-looking scenario rotation.
export const REAL_HISTORY_START_CALENDAR_YEAR = 2019

// One year's crop: the crop name followed by the undersown/catch crop name in
// parentheses when that year has one.
export const formatRotationYear = (year: RotationYear): string =>
  year.undersownCropName
    ? `${year.cropName} (${year.undersownCropName})`
    : year.cropName

// Actual rotation (based on crop codes), formatted as one continuous string.
// Replaces both the old formatCropRotation usage and the separate
// "Virkemidler: ..." line for fields with a calculated rotation (from
// "Optimér").
export const formatRealRotation = (rotation: RotationYear[]): string => {
  if (rotation.length === 0) return 'Intet sædskifte endnu - opret en simulering og kør Optimér'

  return rotation.map(formatRotationYear).join(' - ')
}

export const isFieldLocked = (field: FieldRecord): boolean =>
  field.allowedRotationIds.length === 1 &&
  field.rotationId !== null &&
  field.allowedRotationIds[0] === field.rotationId

export const formatNumber = (value: number) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 }).format(value)

export const formatWholeNumber = (value: number) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 }).format(value)

export const formatFieldCount = (count: number) =>
  `${count} ${count === 1 ? 'mark' : 'marker'}`

export const fieldTitle = (field: Pick<FieldRecord, 'name'>): string =>
  field.name.startsWith('Mark ') ? field.name : `Mark ${field.name}`

const compactMillionFormat = new Intl.NumberFormat('da-DK', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export const formatCompactDkk = (value: number): string => {
  const magnitude = Math.abs(value)
  if (magnitude >= 999_500) {
    return `${compactMillionFormat.format(value / 1_000_000)} mio. kr`
  }
  if (magnitude >= 999.5) return `${formatWholeNumber(value / 1_000)} t.kr`
  return `${formatWholeNumber(value)} kr`
}

export const formatLockTooltip = (field: FieldRecord): string => {
  const lines = [`${field.name} - låst sædskifte`]

  if (field.cropRotation.length > 0) {
    lines.push(field.cropRotation.map(formatRotationYear).join(' - '))
  }

  if (field.areaHa > 0) {
    lines.push(
      `DB2 ${formatNumber(field.db2 / field.areaHa)} kr/ha · ` +
        `Udledning ${formatNumber(field.nLoad / field.areaHa)} kg N/ha · ` +
        `Udvaskning ${formatNumber(field.leaching / field.areaHa)} kg N/ha`,
    )
  }

  lines.push('Optimér ændrer den ikke. Lås op under Regler.')

  return lines.join('\n')
}

export const compactCropSequenceLabel = (cropSequence: string[]): string => {
  const parts: string[] = []
  let index = 0
  while (index < cropSequence.length) {
    const name = cropSequence[index]
    let count = 1
    while (
      index + count < cropSequence.length &&
      cropSequence[index + count] === name
    ) {
      count += 1
    }
    parts.push(count > 1 ? `${name} ×${count}` : name)
    index += count
  }
  return parts.join(' · ')
}

export const emptyMeasures = (): FieldMeasures => ({
  precisionFarming: false,
  coverCropYears: [],
  earlySowingYears: [],
})

export const measureLabels: Record<Measure, string> = {
  PRECISION_FARMING: 'Præcisionslandbrug',
  COVER_CROP: 'Efterafgrøde',
  EARLY_SOWING: 'Tidlig såning',
}

export const cropAllowsEarlySowing = (crop: Crop) =>
  crop === 'CEREAL_WINTER' || crop === 'CEREAL_WINTER_AFTER_GRASS'

export const cropAllowsCoverCrop = (rotation: Crop[], index: number) => {
  if (rotation.length === 0) return false
  const nextCrop = rotation[(index + 1) % rotation.length]
  return !cropAllowsEarlySowing(nextCrop)
}

export const normalizeMeasuresForRotation = (
  measures: FieldMeasures,
  rotation: Crop[],
): FieldMeasures => ({
  precisionFarming: measures.precisionFarming,
  coverCropYears: measures.coverCropYears.filter(
    (index) => index < rotation.length && cropAllowsCoverCrop(rotation, index),
  ),
  earlySowingYears: measures.earlySowingYears.filter(
    (index) =>
      index < rotation.length && cropAllowsEarlySowing(rotation[index]),
  ),
})

export const measuresEqual = (left: FieldMeasures, right: FieldMeasures) =>
  left.precisionFarming === right.precisionFarming &&
  left.coverCropYears.length === right.coverCropYears.length &&
  left.coverCropYears.every(
    (year, index) => year === right.coverCropYears[index],
  ) &&
  left.earlySowingYears.length === right.earlySowingYears.length &&
  left.earlySowingYears.every(
    (year, index) => year === right.earlySowingYears[index],
  )

export const formatMeasures = (measures: FieldMeasures) => {
  const labels: string[] = []
  if (measures.precisionFarming) labels.push(measureLabels.PRECISION_FARMING)
  if (measures.coverCropYears.length > 0) {
    labels.push(
      `${measureLabels.COVER_CROP}: år ${measures.coverCropYears.map((year) => year + 1).join(', ')}`,
    )
  }
  if (measures.earlySowingYears.length > 0) {
    labels.push(
      `${measureLabels.EARLY_SOWING}: år ${measures.earlySowingYears.map((year) => year + 1).join(', ')}`,
    )
  }
  return labels.length > 0 ? labels.join(' · ') : 'Ingen'
}

export const rotationCategory = (name: string): string => {
  const match = name.match(/^(.+?)\s+\d+$/)
  return match ? match[1] : name
}

export type RotationCategoryGroup = {
  category: string
  rotations: NamedRotation[]
}

export const groupRotationsByCategory = (
  rotations: NamedRotation[],
): RotationCategoryGroup[] => {
  const groups: RotationCategoryGroup[] = []
  const byCategory = new Map<string, RotationCategoryGroup>()

  for (const rotation of rotations) {
    const category = rotationCategory(rotation.name)
    let group = byCategory.get(category)
    if (!group) {
      group = { category, rotations: [] }
      byCategory.set(category, group)
      groups.push(group)
    }
    group.rotations.push(rotation)
  }

  return groups
}

export const rotationsEqual = (left: RotationYear[], right: RotationYear[]) =>
  left.length === right.length &&
  left.every(
    (year, index) =>
      year.cropCode === right[index].cropCode &&
      year.undersownCropCode === right[index].undersownCropCode,
  )

export const changedFieldIds = (
  viewFields: FieldRecord[],
  liveFields: FieldRecord[],
): Set<string> => {
  const liveRotationByImk = new Map<number, RotationYear[]>()
  for (const field of liveFields) {
    if (field.imkId !== null) {
      liveRotationByImk.set(field.imkId, field.cropRotation)
    }
  }

  const changed = new Set<string>()
  for (const field of viewFields) {
    if (field.imkId === null) continue
    const liveRotation = liveRotationByImk.get(field.imkId)
    if (!liveRotation) {
      // The field no longer exists in the live crop history (e.g. removed
      // from the farm) - that is a difference too, not something to ignore.
      changed.add(field.id)
      continue
    }
    if (
      !rotationsEqual(field.cropRotation, liveRotation) ||
      !measuresEqual(field.measures, emptyMeasures())
    ) {
      changed.add(field.id)
    }
  }

  return changed
}

export const isFieldCalculated = (
  field: FieldRecord,
  isSimulationView: boolean,
): boolean => {
  if (isSimulationView) return field.rotationId !== null
  return (
    field.db2 !== 0 ||
    field.nLoad !== 0 ||
    field.leaching !== 0 ||
    field.feedUnits !== 0
  )
}

export const QUOTA_STATUS_NEAR_THRESHOLD = 0.9

export type QuotaStatusLevel =
  | 'ok'
  | 'near'
  | 'over'
  | 'uncalculated'
  | 'noData'
  | 'partial'
  | 'excluded'

export const quotaStatusLevel = (
  nLoad: number,
  quotaKgn: number,
  isCalculated: boolean,
): QuotaStatusLevel => {
  if (!isCalculated) return 'uncalculated'
  if (quotaKgn === 0) return 'noData'
  const ratio = nLoad / quotaKgn
  if (ratio > 1) return 'over'
  if (ratio >= QUOTA_STATUS_NEAR_THRESHOLD) return 'near'
  return 'ok'
}

export const aggregateQuotaStatusLevel = (
  nLoad: number,
  quotaKgn: number,
  calculatedCount: number,
  totalCount: number,
): QuotaStatusLevel => {
  if (calculatedCount === 0) return 'uncalculated'
  if (quotaKgn === 0) return 'noData'
  if (calculatedCount < totalCount) {
    return nLoad > quotaKgn ? 'over' : 'partial'
  }
  return quotaStatusLevel(nLoad, quotaKgn, true)
}

export type QuotaStatus = {
  level: QuotaStatusLevel
  nLoad: number
  quotaKgn: number
}

export const getFieldQuotaStatus = (
  field: FieldRecord,
  isSimulationView: boolean,
): QuotaStatus => ({
  level: field.quotaEligible
    ? quotaStatusLevel(
        field.nLoad,
        field.nLoadQuotaKgN,
        isFieldCalculated(field, isSimulationView),
      )
    : 'excluded',
  nLoad: field.nLoad,
  quotaKgn: field.nLoadQuotaKgN,
})

export const formatQuotaAmount = (
  nLoad: number,
  quotaKgn: number,
  format: (value: number) => string = formatNumber,
): string =>
  quotaKgn > 0
    ? `${format(nLoad)} af ${format(quotaKgn)} kg N`
    : `${format(nLoad)} kg N`

export const quotaPercent = (nLoad: number, quotaKgN: number): number | null =>
  quotaKgN > 0 ? (nLoad / quotaKgN) * 100 : null

export const formatQuotaPercent = (nLoad: number, quotaKgN: number): string => {
  const percent = quotaPercent(nLoad, quotaKgN)
  return percent === null ? '-' : `${formatWholeNumber(percent)} %`
}

export type QuotaStatusStyle = {
  dot: string
  accent: string
  rowAccent: string | null
  surface: string
  text: string
}

const QUOTA_STATUS_STYLE_UNKNOWN: QuotaStatusStyle = {
  dot: 'bg-muted-foreground/60',
  accent: 'border-l-muted-foreground/60',
  rowAccent: null,
  surface: 'border-border bg-muted/50',
  text: 'text-muted-foreground',
}

export const QUOTA_STATUS_STYLES: Record<QuotaStatusLevel, QuotaStatusStyle> = {
  ok: {
    dot: 'bg-green-600',
    accent: 'border-l-green-600',
    rowAccent: null,
    surface: 'border-green-200 bg-green-50',
    text: 'text-green-800',
  },
  near: {
    dot: 'bg-amber-600',
    accent: 'border-l-amber-600',
    rowAccent: 'before:bg-amber-600',
    surface: 'border-amber-200 bg-amber-50',
    text: 'text-amber-800',
  },
  over: {
    dot: 'bg-red-600',
    accent: 'border-l-red-600',
    rowAccent: 'before:bg-red-600',
    surface: 'border-red-200 bg-red-50',
    text: 'text-red-800',
  },
  uncalculated: QUOTA_STATUS_STYLE_UNKNOWN,
  noData: QUOTA_STATUS_STYLE_UNKNOWN,
  partial: QUOTA_STATUS_STYLE_UNKNOWN,
  excluded: QUOTA_STATUS_STYLE_UNKNOWN,
}

export const QUOTA_STATUS_LABELS: Record<QuotaStatusLevel, string> = {
  ok: 'Under kvote',
  near: 'Tæt på kvote',
  over: 'Over kvote',
  uncalculated: 'Ikke beregnet',
  noData: 'Ingen kvote',
  partial: 'Delvist beregnet',
  excluded: 'Ikke kvotegivende',
}

export type FieldTotals = {
  fieldCount: number
  calculatedCount: number
  uncalculatedCount: number
  excludedCount: number
  areaHa: number
  db2: number
  nLoad: number
  leaching: number
  feedUnits: number
  nLoadQuotaKgN: number
}

export const computeFieldTotals = (
  fields: FieldRecord[],
  isSimulationView: boolean,
): FieldTotals => {
  const totals: FieldTotals = {
    fieldCount: fields.length,
    calculatedCount: 0,
    uncalculatedCount: 0,
    excludedCount: 0,
    areaHa: 0,
    db2: 0,
    nLoad: 0,
    leaching: 0,
    feedUnits: 0,
    nLoadQuotaKgN: 0,
  }

  for (const field of fields) {
    totals.areaHa += field.areaHa
    if (!field.quotaEligible) totals.excludedCount += 1
    if (!isFieldCalculated(field, isSimulationView)) continue
    totals.calculatedCount += 1
    totals.db2 += field.db2
    totals.feedUnits += field.feedUnits
    // A mark that is not quota eligible draws down no quota and must not
    // contribute to the N load it is compared against either - see
    // getFieldQuotaStatus.
    if (field.quotaEligible) {
      totals.nLoadQuotaKgN += field.nLoadQuotaKgN
      totals.nLoad += field.nLoad
      totals.leaching += field.leaching
    }
  }

  totals.uncalculatedCount = fields.length - totals.calculatedCount
  return totals
}

export const totalsQuotaStatusLevel = (totals: FieldTotals): QuotaStatusLevel =>
  aggregateQuotaStatusLevel(
    totals.nLoad,
    totals.nLoadQuotaKgN,
    totals.calculatedCount,
    totals.fieldCount,
  )

export const describeUncalculatedCount = (
  totals: FieldTotals,
): string | null =>
  totals.calculatedCount > 0 && totals.uncalculatedCount > 0
    ? `${totals.uncalculatedCount} ikke beregnet`
    : null

export type CatchmentTotals = {
  catchmentId: number | null
  totals: FieldTotals
}

const combineQuotaStatusLevels = (
  levels: QuotaStatusLevel[],
): QuotaStatusLevel => {
  if (levels.includes('over')) return 'over'
  if (levels.length > 0 && levels.every((level) => level === 'uncalculated')) {
    return 'uncalculated'
  }
  if (levels.some((level) => level === 'uncalculated' || level === 'partial')) {
    return 'partial'
  }
  if (levels.includes('near')) return 'near'
  if (levels.includes('ok')) return 'ok'
  return 'noData'
}

export type CatchmentQuota = {
  catchmentId: number
  totals: FieldTotals
  level: QuotaStatusLevel
}

export type FarmQuota = {
  totals: FieldTotals
  level: QuotaStatusLevel
  quotaKgN: number | null
  catchments: CatchmentQuota[]
  overCount: number
}

export const resolveFarmQuota = (
  fields: FieldRecord[],
  isSimulationView: boolean,
): FarmQuota => {
  const totals = computeFieldTotals(fields, isSimulationView)
  const catchments = groupFieldsByCatchment(fields, isSimulationView).flatMap(
    ({ catchmentId, totals: catchmentTotals }) =>
      catchmentId !== null &&
      catchmentTotals.fieldCount > catchmentTotals.excludedCount
        ? [
            {
              catchmentId,
              totals: catchmentTotals,
              level: totalsQuotaStatusLevel(catchmentTotals),
            },
          ]
        : [],
  )
  const separate = catchments.length > 1
  const levels = catchments.map((catchment) => catchment.level)
  const overCount = catchments.filter(
    (catchment) => catchment.level === 'over',
  ).length
  return {
    totals,
    level: separate
      ? combineQuotaStatusLevels(levels)
      : totalsQuotaStatusLevel(totals),
    quotaKgN: separate ? null : totals.nLoadQuotaKgN,
    catchments,
    overCount,
  }
}

export const describeSeparateQuotas = (quota: FarmQuota): string => {
  const count = quota.catchments.length
  if (quota.overCount > 0) {
    return `${quota.overCount} af ${count} oplande over grænsen`
  }
  if (quota.level === 'ok' || quota.level === 'near') {
    return `alle ${count} oplande under grænsen`
  }
  return `${count} oplande med hver sin kvote`
}

export const groupFieldsByCatchment = (
  fields: FieldRecord[],
  isSimulationView: boolean,
): CatchmentTotals[] => {
  const fieldsByCatchment = new Map<number | null, FieldRecord[]>()
  for (const field of fields) {
    const group = fieldsByCatchment.get(field.catchmentId)
    if (group) group.push(field)
    else fieldsByCatchment.set(field.catchmentId, [field])
  }

  return Array.from(fieldsByCatchment, ([catchmentId, group]) => ({
    catchmentId,
    totals: computeFieldTotals(group, isSimulationView),
  }))
}

export const formatCatchmentAmount = (totals: FieldTotals): string => {
  if (totals.calculatedCount === 0) return 'ikke beregnet'
  if (totals.nLoadQuotaKgN === 0) {
    return `${formatNumber(totals.nLoad)} kg N, ingen kvote`
  }
  return `${formatNumber(totals.nLoad)} / ${formatNumber(totals.nLoadQuotaKgN)} kg N`
}

export const orderFieldsByCatchment = (
  fields: FieldRecord[],
  catchmentLabel: (catchmentId: number | null) => string,
): FieldRecord[] => {
  const groups = new Map<number | null, FieldRecord[]>()
  for (const field of fields) {
    const group = groups.get(field.catchmentId)
    if (group) group.push(field)
    else groups.set(field.catchmentId, [field])
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => {
      if (left === null) return 1
      if (right === null) return -1
      return catchmentLabel(left).localeCompare(catchmentLabel(right), 'da')
    })
    .flatMap(([, group]) => group)
}

export type CatchmentRun = {
  firstFieldId: string
  catchmentId: number | null
  totals: FieldTotals
}

export const catchmentRuns = (
  orderedFields: FieldRecord[],
  isSimulationView: boolean,
): CatchmentRun[] => {
  const runs: CatchmentRun[] = []
  let current: FieldRecord[] = []
  const closeRun = () => {
    if (current.length === 0) return
    runs.push({
      firstFieldId: current[0].id,
      catchmentId: current[0].catchmentId,
      totals: computeFieldTotals(current, isSimulationView),
    })
    current = []
  }
  for (const field of orderedFields) {
    if (current.length > 0 && current[0].catchmentId !== field.catchmentId) {
      closeRun()
    }
    current.push(field)
  }
  closeRun()
  return runs
}

const yearResultHasValues = (
  yearResult: RotationCandidateYearResult,
): boolean =>
  yearResult.dbDkkHa !== 0 ||
  yearResult.leachingKgNHa !== 0 ||
  (yearResult.dbDetail.yieldUnit === 'FE/ha' &&
    (Number(yearResult.dbDetail.yieldAmount) || 0) !== 0)

const calendarYearOf = (index: number, history: boolean): number =>
  history ? REAL_HISTORY_START_CALENDAR_YEAR + index : index + 1

const yearResultNLoadKg = (
  field: FieldRecord,
  yearResult: RotationCandidateYearResult,
): number =>
  yearResult.leachingKgNHa * field.areaHa * (1 - (field.retention ?? 0) / 100)

export const summarizeFieldYears = (
  fields: FieldRecord[],
  yearsByFieldId: FieldYearValues | undefined,
  history: boolean,
): YearlySummaryEntry[] => {
  const buckets = new Map<number, YearlySummaryEntry>()
  for (const field of fields) {
    const years = yearsByFieldId?.[field.id]
    if (!years) continue
    years.forEach((yearResult, index) => {
      if (!yearResultHasValues(yearResult)) return
      const year = calendarYearOf(index, history)
      const bucket = buckets.get(year) ?? {
        year,
        totalNLoadKg: 0,
        totalDb2: 0,
        totalFeedUnits: 0,
        fieldCount: 0,
      }
      if (field.quotaEligible) {
        bucket.totalNLoadKg += yearResultNLoadKg(field, yearResult)
      }
      bucket.totalDb2 += yearResult.dbDkkHa * field.areaHa
      if (yearResult.dbDetail.yieldUnit === 'FE/ha') {
        bucket.totalFeedUnits +=
          (Number(yearResult.dbDetail.yieldAmount) || 0) * field.areaHa
      }
      bucket.fieldCount += 1
      buckets.set(year, bucket)
    })
  }
  return [...buckets.values()].sort((left, right) => left.year - right.year)
}

export const applyFieldYearValues = (
  fields: FieldRecord[],
  yearsByFieldId: FieldYearValues,
  yearIndex: number,
): FieldRecord[] =>
  fields.map((field) => {
    const yearResult = yearsByFieldId[field.id]?.[yearIndex]
    if (!yearResult || !yearResultHasValues(yearResult)) {
      return {
        ...field,
        rotationId: null,
        db2: 0,
        nLoad: 0,
        leaching: 0,
        feedUnits: 0,
      }
    }
    return {
      ...field,
      db2: yearResult.dbDkkHa * field.areaHa,
      nLoad:
        yearNLoadKgHa(yearResult.leachingKgNHa, field.retention) *
        field.areaHa,
      leaching: yearResult.leachingKgNHa * field.areaHa,
      feedUnits:
        yearResult.dbDetail.yieldUnit === 'FE/ha'
          ? (Number(yearResult.dbDetail.yieldAmount) || 0) * field.areaHa
          : 0,
    }
  })

export type CatchmentYearTotals = {
  nLoadKg: number
  quotaKgN: number
  fieldCount: number
}

export type CatchmentTotalsByYear = Map<
  number | null,
  Record<number, CatchmentYearTotals>
>

export const summarizeCatchmentYearTotals = (
  fields: FieldRecord[],
  yearsByFieldId: FieldYearValues | undefined,
  history: boolean,
): CatchmentTotalsByYear => {
  const byCatchment: CatchmentTotalsByYear = new Map()
  for (const field of fields) {
    const years = yearsByFieldId?.[field.id]
    if (!years) continue
    const byYear = byCatchment.get(field.catchmentId) ?? {}
    byCatchment.set(field.catchmentId, byYear)
    years.forEach((yearResult, index) => {
      if (!yearResultHasValues(yearResult)) return
      const year = calendarYearOf(index, history)
      const totals =
        byYear[year] ?? (byYear[year] = { nLoadKg: 0, quotaKgN: 0, fieldCount: 0 })
      if (field.quotaEligible) {
        totals.nLoadKg += yearResultNLoadKg(field, yearResult)
        totals.quotaKgN += field.nLoadQuotaKgN
      }
      totals.fieldCount += 1
    })
  }
  return byCatchment
}

export type CropShareLevel = 'group' | 'crop'

export type CropShare = {
  id: string
  label: string
  group: CropGroupDefinition
  areaHa: number
  share: number
  nLoadKgHa: number
}

type CropShareTotals = {
  label: string
  group: CropGroupDefinition
  areaHa: number
  nLoadKg: number
}

export const summarizeCropDistribution = (
  fields: FieldRecord[],
  yearsByFieldId: FieldYearValues | undefined,
  yearIndex: number | null,
  level: CropShareLevel,
): CropShare[] => {
  const totalsById = new Map<string, CropShareTotals>()
  let totalHa = 0
  for (const field of fields) {
    const years = yearsByFieldId?.[field.id]
    if (!years) continue
    const candidates =
      yearIndex === null ? years : years.slice(yearIndex, yearIndex + 1)
    const counted = candidates.filter(yearResultHasValues)
    if (counted.length === 0) continue
    const areaPerYear = field.areaHa / counted.length
    totalHa += field.areaHa
    for (const yearResult of counted) {
      const { cropCode, cropName } = yearResult.year
      const group = cropGroupFor(cropCode, cropName)
      const label = level === 'group' ? group.label : shortCropName(cropName)
      const id = level === 'group' ? group.id : `${group.id}:${label}`
      const totals = totalsById.get(id) ?? {
        label,
        group,
        areaHa: 0,
        nLoadKg: 0,
      }
      const yearNLoad = yearNLoadKgHa(yearResult.leachingKgNHa, field.retention)
      totals.areaHa += areaPerYear
      totals.nLoadKg += yearNLoad * areaPerYear
      totalsById.set(id, totals)
    }
  }
  if (totalHa === 0) return []
  return [...totalsById.entries()]
    .map(([id, totals]) => ({
      id,
      label: totals.label,
      group: totals.group,
      areaHa: totals.areaHa,
      share: totals.areaHa / totalHa,
      nLoadKgHa: totals.nLoadKg / totals.areaHa,
    }))
    .sort((left, right) => right.areaHa - left.areaHa)
}
