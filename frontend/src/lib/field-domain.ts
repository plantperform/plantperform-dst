import type {
  Crop,
  FieldMeasures,
  FieldRecord,
  Measure,
  NamedRotation,
  RotationYear,
} from '@/api/types'

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

export const ROTATION_START_CALENDAR_YEAR = 2027
export const CURRENT_CALENDAR_YEAR = new Date().getFullYear()

export const REAL_HISTORY_START_CALENDAR_YEAR = 2019

export const formatRotationYear = (year: RotationYear): string =>
  year.udlaegNavn ? `${year.afgrodeNavn} (${year.udlaegNavn})` : year.afgrodeNavn

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
    while (index + count < cropSequence.length && cropSequence[index + count] === name) {
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
      year.afgrodeKode === right[index].afgrodeKode &&
      year.udlaegKode === right[index].udlaegKode,
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
    if (!liveRotation) continue
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
    field.fen !== 0
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

export type FarmQuotaBasis = 'summen af markernes kvoter'

export type ResolvedFarmQuota = {
  quotaKgn: number
  basis: FarmQuotaBasis
}

export const resolveFarmQuota = (fieldQuotaSum: number): ResolvedFarmQuota => ({
  quotaKgn: fieldQuotaSum,
  basis: 'summen af markernes kvoter',
})

export const getFieldQuotaStatus = (
  field: FieldRecord,
  isSimulationView: boolean,
): QuotaStatus => ({
  level: quotaStatusLevel(
    field.nLoad,
    field.udledningskvoteMarkKgn,
    isFieldCalculated(field, isSimulationView),
  ),
  nLoad: field.nLoad,
  quotaKgn: field.udledningskvoteMarkKgn,
})

export const formatQuotaAmount = (status: QuotaStatus): string =>
  `${formatNumber(status.nLoad)} af ${formatNumber(status.quotaKgn)} kg N`

export type QuotaStatusStyle = {
  dot: string
  surface: string
  text: string
  badgeLabel: string | null
}

const QUOTA_STATUS_STYLE_UNKNOWN: QuotaStatusStyle = {
  dot: 'bg-muted-foreground/60',
  surface: 'border-border bg-muted/50',
  text: 'text-muted-foreground',
  badgeLabel: null,
}

export const QUOTA_STATUS_STYLES: Record<QuotaStatusLevel, QuotaStatusStyle> = {
  ok: {
    dot: 'bg-green-600',
    surface: 'border-green-200 bg-green-50',
    text: 'text-green-800',
    badgeLabel: null,
  },
  near: {
    dot: 'bg-amber-600',
    surface: 'border-amber-200 bg-amber-50',
    text: 'text-amber-800',
    badgeLabel: 'tæt på',
  },
  over: {
    dot: 'bg-red-600',
    surface: 'border-red-200 bg-red-50',
    text: 'text-red-800',
    badgeLabel: 'over',
  },
  uncalculated: QUOTA_STATUS_STYLE_UNKNOWN,
  noData: QUOTA_STATUS_STYLE_UNKNOWN,
  partial: QUOTA_STATUS_STYLE_UNKNOWN,
}

export type FieldTotals = {
  fieldCount: number
  calculatedCount: number
  uncalculatedCount: number
  areaHa: number
  db2: number
  nLoad: number
  leaching: number
  fen: number
  udledningskvoteMarkKgn: number
}

export const computeFieldTotals = (
  fields: FieldRecord[],
  isSimulationView: boolean,
): FieldTotals => {
  const totals: FieldTotals = {
    fieldCount: fields.length,
    calculatedCount: 0,
    uncalculatedCount: 0,
    areaHa: 0,
    db2: 0,
    nLoad: 0,
    leaching: 0,
    fen: 0,
    udledningskvoteMarkKgn: 0,
  }

  for (const field of fields) {
    totals.areaHa += field.areaHa
    totals.udledningskvoteMarkKgn += field.udledningskvoteMarkKgn
    if (!isFieldCalculated(field, isSimulationView)) continue
    totals.calculatedCount += 1
    totals.db2 += field.db2
    totals.nLoad += field.nLoad
    totals.leaching += field.leaching
    totals.fen += field.fen
  }

  totals.uncalculatedCount = fields.length - totals.calculatedCount
  return totals
}

export const totalsQuotaStatusLevel = (totals: FieldTotals): QuotaStatusLevel =>
  aggregateQuotaStatusLevel(
    totals.nLoad,
    totals.udledningskvoteMarkKgn,
    totals.calculatedCount,
    totals.fieldCount,
  )

export type CatchmentTotals = {
  kystvandId: number | null
  totals: FieldTotals
}

export const groupFieldsByCatchment = (
  fields: FieldRecord[],
  isSimulationView: boolean,
): CatchmentTotals[] => {
  const fieldsByCatchment = new Map<number | null, FieldRecord[]>()
  for (const field of fields) {
    const group = fieldsByCatchment.get(field.kystvandId)
    if (group) group.push(field)
    else fieldsByCatchment.set(field.kystvandId, [field])
  }

  return Array.from(fieldsByCatchment, ([kystvandId, group]) => ({
    kystvandId,
    totals: computeFieldTotals(group, isSimulationView),
  }))
}

export const YEAR_BAR_FILL_COLOR = '#cfdfc6'
export const YEAR_BAR_OVER_COLOR = '#f87171'

export const CROP_YEAR_PALETTE = ['#c9973f', '#a7c69b', '#7fb5a8', '#c9b27f']
export const CROP_YEAR_COVER_CROP_BORDER = '#176433'
export const CROP_YEAR_FALLBACK_COLOR = '#a7c69b'

export const buildCropColorMap = (fields: FieldRecord[]): Map<number, string> => {
  const colorByCropCode = new Map<number, string>()
  for (const field of fields) {
    for (const year of field.cropRotation) {
      if (!colorByCropCode.has(year.afgrodeKode)) {
        colorByCropCode.set(
          year.afgrodeKode,
          CROP_YEAR_PALETTE[colorByCropCode.size % CROP_YEAR_PALETTE.length],
        )
      }
    }
  }
  return colorByCropCode
}
