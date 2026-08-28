import type {
  Crop,
  FieldMeasures,
  FieldRecord,
  Measure,
  NamedRotation,
  RotationYear,
  Soil,
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

// NLES 13-class aggregation. Code 0 ("NotInNLESAgg") and missing values are
// intentionally absent here; parseRegistryRotation falls back to CEREAL_WINTER
// until the agronomic mapping for these is decided.
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

// TODO: Stop substituting CEREAL_WINTER for unknown / NotInNLESAgg / missing
// registry crop ids. Empty positions in Rot_vec (e.g. "2_2_1_1__4_8") and the
// explicit "0" NotInNLESAgg code both fall through to CEREAL_WINTER until
// agronomic guidance is settled.
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

export const soilFromRegistryNumber = (value: number | null): Soil => {
  if (value === null) throw new Error('Jordtype-id mangler')
  if (value === 10) return 'SAND'
  if (value === 11 || value === 20) return 'CLAY'

  throw new Error(`Ikke understøttet jordtype-id ${value}`)
}

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

// Startkalenderår for den 8-årige rotation — skal matche backend'ens
// candidate_evaluator.py::_START_CALENDAR_YEAR. Position 1 = dette år,
// position 2 = +1, osv. (position 1 svarer til RotationYear-index 0).
export const ROTATION_START_CALENDAR_YEAR = 2024

// Ét års afgrøde — afgrødenavn og, når der er et udlæg/efterafgrøde det år,
// navnet i parentes lige efter.
export const formatRotationYear = (year: RotationYear): string =>
  year.udlaegNavn ? `${year.afgrodeNavn} (${year.udlaegNavn})` : year.afgrodeNavn

// Rigtigt sædskifte (afgrødekode-baseret), som én sammenhængende streng.
// Erstatter både den gamle formatCropRotation-brug og den separate
// "Virkemidler: ..."-linje for marker der har et beregnet sædskifte (fra
// "Optimér").
export const formatRealRotation = (rotation: RotationYear[]): string => {
  if (rotation.length === 0) return 'Intet sædskifte endnu — opret et scenarie og kør Optimér'

  return rotation.map(formatRotationYear).join(' - ')
}

export const isFieldLocked = (field: FieldRecord): boolean =>
  field.allowedRotationIds.length === 1 &&
  field.rotationId !== null &&
  field.allowedRotationIds[0] === field.rotationId

const tooltipNumber = new Intl.NumberFormat('da-DK', {
  maximumFractionDigits: 1,
})

export const formatLockTooltip = (field: FieldRecord): string => {
  const lines = [`${field.name} — låst sædskifte`]

  if (field.cropRotation.length > 0) {
    lines.push(field.cropRotation.map(formatRotationYear).join(' - '))
  }

  if (field.areaHa > 0) {
    lines.push(
      `DB2 ${tooltipNumber.format(field.db2 / field.areaHa)} kr/ha · ` +
        `Udledning ${tooltipNumber.format(field.nLoad / field.areaHa)} kg N/ha · ` +
        `Udvaskning ${tooltipNumber.format(field.leaching / field.areaHa)} kg N/ha`,
    )
  }

  lines.push('Optimér ændrer den ikke. Lås op under Regler.')

  return lines.join('\n')
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

// Rotation names follow the pattern "<Category> <nr>" (e.g. "Konventionel
// Kvæg 201"), except single-category rotations like "Brak". The category is the
// name with a trailing number stripped, used to group rotations in the
// selection UIs.
export const rotationCategory = (name: string): string => {
  const match = name.match(/^(.+?)\s+\d+$/)
  return match ? match[1] : name
}

export type RotationCategoryGroup = {
  category: string
  rotations: NamedRotation[]
}

// Groups rotations by their derived category, preserving first-seen order.
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

export const formatSoil = (soil: Soil) => {
  if (soil === 'SAND') return 'Sandjord'
  return 'Lerjord'
}

export const rotationsEqual = (left: RotationYear[], right: RotationYear[]) =>
  left.length === right.length &&
  left.every(
    (year, index) =>
      year.afgrodeKode === right[index].afgrodeKode &&
      year.udlaegKode === right[index].udlaegKode,
  )

// Returns the ids of the view fields whose crop rotation differs from the live
// ("Aktuel") field it was snapshotted from. The snapshot regenerates `id`, so
// the join key is `imkId`. Manually-added fields (imkId === null) have no live
// original to compare against and are treated as unchanged.
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
