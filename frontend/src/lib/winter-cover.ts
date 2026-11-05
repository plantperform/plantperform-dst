import type { RotationYear } from '@/api/types'
import { cropLabel } from '@/lib/crop-label'

export type WinterCoverKind =
  | 'catchCrop'
  | 'intermediateCrop'
  | 'winterCereal'
  | 'grassRapeBeets'
  | 'undersownOrFallow'
  | 'stubble'
  | 'bareSoil'
  | 'earlySowing'
  | 'intermediateOrEarlySowing'

export type WinterCoverDefinition = {
  id: WinterCoverKind
  label: string
  description: string
  color: string
  // Drawn split down the middle in these colours: the history only knows it
  // was one of two covers.
  splitColors?: readonly [string, string]
}

export type YearCover = {
  cover: WinterCoverDefinition
  description: string
}

export const CATCH_CROP: WinterCoverDefinition = {
  id: 'catchCrop',
  label: 'Efterafgrøde',
  description: 'Sået efter høst og optager kvælstof i efteråret.',
  color: '#0d9488',
}

export const INTERMEDIATE_CROP: WinterCoverDefinition = {
  id: 'intermediateCrop',
  label: 'Mellemafgrøde',
  description: 'Dækker jorden en kort tid efter høst og optager kvælstof.',
  color: '#db2777',
}

export const WINTER_CEREAL: WinterCoverDefinition = {
  id: 'winterCereal',
  label: 'Vintersæd',
  description: 'Vintersæd dækker jorden vinteren over.',
  color: '#2563eb',
}

export const GRASS_RAPE_BEETS: WinterCoverDefinition = {
  id: 'grassRapeBeets',
  label: 'Græs, raps og roer',
  description:
    'Græs, kløvergræs, vinterraps eller roer står på marken langt ind i efteråret.',
  color: '#4d7c0f',
}

export const UNDERSOWN_OR_FALLOW: WinterCoverDefinition = {
  id: 'undersownOrFallow',
  label: 'Undersået græs og brak',
  description: 'Undersået græs eller brak dækker jorden vinteren over.',
  color: '#a3c46a',
}

export const STUBBLE: WinterCoverDefinition = {
  id: 'stubble',
  label: 'Stub',
  description:
    'Stubben står urørt, og kun ukrudt og spildkorn dækker jorden vinteren over.',
  color: '#f97316',
}

export const BARE_SOIL: WinterCoverDefinition = {
  id: 'bareSoil',
  label: 'Bar jord',
  description: 'Jorden er bearbejdet og ligger uden plantevækst vinteren over.',
  color: '#a8a29e',
}

export const EARLY_SOWING: WinterCoverDefinition = {
  id: 'earlySowing',
  label: 'Tidlig såning',
  description:
    'Vintersæden er sået tidligt, så den optager kvælstof i efteråret.',
  color: '#6d28d9',
}

// A reported catch crop before an autumn-sown crop: the source does not say
// which of the two met the requirement, and both have the same effect. The
// history names such a year's secondary crop with this label (the backend's
// AUTUMN_MEASURE_NAME); a simulation never does.
export const INTERMEDIATE_OR_EARLY_SOWING: WinterCoverDefinition = {
  id: 'intermediateOrEarlySowing',
  label: 'Mellemafgrøde/tidlig såning',
  description:
    'Indberettet efterafgrøde før en efterårssået afgrøde. Kilden siger ikke, om det var en mellemafgrøde eller tidlig såning, men de tæller ens.',
  color: INTERMEDIATE_CROP.color,
  splitColors: [INTERMEDIATE_CROP.color, EARLY_SOWING.color],
}

// Such a year is shown by its cover, not as an udlæg.
export const isIntermediateOrEarlySowingYear = (year: RotationYear): boolean =>
  year.undersownCropName === INTERMEDIATE_OR_EARLY_SOWING.label

export const shownUndersownCropName = (year: RotationYear): string | null =>
  isIntermediateOrEarlySowingYear(year) ? null : year.undersownCropName

export const shownUndersownCropLabel = (year: RotationYear): string | null => {
  const name = shownUndersownCropName(year)
  return name === null ? null : cropLabel(year.undersownCropCode, name)
}

const WINTER_COVERS: readonly WinterCoverDefinition[] = [
  CATCH_CROP,
  INTERMEDIATE_CROP,
  WINTER_CEREAL,
  GRASS_RAPE_BEETS,
  UNDERSOWN_OR_FALLOW,
  STUBBLE,
  BARE_SOIL,
  EARLY_SOWING,
  INTERMEDIATE_OR_EARLY_SOWING,
]

export const winterCoverDefinition = (
  id: WinterCoverKind,
): WinterCoverDefinition => {
  const definition = WINTER_COVERS.find((cover) => cover.id === id)
  if (!definition) throw new Error(`Unknown winter cover ${id}`)
  return definition
}

const yearCover = (
  cover: WinterCoverDefinition,
  description = cover.description,
): YearCover => ({ cover, description })

const W_COVERS: Record<number, YearCover> = {
  1: yearCover(WINTER_CEREAL),
  2: yearCover(BARE_SOIL, 'Jorden ligger bar vinteren over.'),
  3: yearCover(
    BARE_SOIL,
    'Efter majs eller kartofler ligger jorden bar vinteren over.',
  ),
  4: yearCover(
    UNDERSOWN_OR_FALLOW,
    'Efterafgrøder, undersået græs eller brak dækker jorden vinteren over.',
  ),
  5: yearCover(
    STUBBLE,
    'Stubben står urørt, og kun ukrudt og spildkorn dækker jorden vinteren over.',
  ),
  6: yearCover(GRASS_RAPE_BEETS),
  7: yearCover(
    WINTER_CEREAL,
    'Vintersæd efter græs dækker jorden vinteren over.',
  ),
  8: yearCover(
    GRASS_RAPE_BEETS,
    'Græs eller kløvergræs, der først pløjes sent, dækker jorden det meste af vinteren.',
  ),
}

export const yearCoverForW = (w: number): YearCover | null =>
  W_COVERS[w] ?? null

const CATCH_CROP_CODES = new Set([968, 9680, 970])
const INTERMEDIATE_CROP_CODES = new Set([9682, 9684])
const UNDERSOWN_COVER_CODES = new Set([960, 961, 962, 963, 964, 965, 966, 2000])
const EARLY_SOWING_CODE = 9683

const isOn = (value: unknown): boolean => Number(value ?? 0) > 0

export const yearCoversFromDetail = (
  detail: Record<string, unknown>,
): YearCover[] => {
  if (detail.runoffCategoryUnknown) return []
  if (isOn(detail.intermediateOrEarlySowing)) {
    return [yearCover(INTERMEDIATE_OR_EARLY_SOWING)]
  }
  const state = isOn(detail.EEA)
    ? yearCover(CATCH_CROP)
    : isOn(detail.EMA)
      ? yearCover(INTERMEDIATE_CROP)
      : yearCoverForW(Number(detail.W_used ?? detail.W))
  const covers = state ? [state] : []
  if (isOn(detail.ETS)) covers.push(yearCover(EARLY_SOWING))
  return covers
}

const yearCoversFromUndersownCrop = (year: RotationYear): YearCover[] => {
  const code = year.undersownCropCode
  if (code === null) return []
  if (isIntermediateOrEarlySowingYear(year)) {
    return [yearCover(INTERMEDIATE_OR_EARLY_SOWING)]
  }
  if (CATCH_CROP_CODES.has(code)) return [yearCover(CATCH_CROP)]
  if (INTERMEDIATE_CROP_CODES.has(code)) return [yearCover(INTERMEDIATE_CROP)]
  if (code === EARLY_SOWING_CODE) return [yearCover(EARLY_SOWING)]
  if (UNDERSOWN_COVER_CODES.has(code)) {
    return [
      yearCover(
        UNDERSOWN_OR_FALLOW,
        'Udlæg af græs eller frøgræs står på marken efter høst.',
      ),
    ]
  }
  return []
}

export const rotationCovers = (
  rotation: RotationYear[],
  details: (Record<string, unknown> | undefined)[] = [],
): YearCover[][] | null => {
  const covers = rotation.map((year, index) => {
    const detail = details[index]
    return detail?.W !== undefined
      ? yearCoversFromDetail(detail)
      : yearCoversFromUndersownCrop(year)
  })
  return covers.some((yearCovers) => yearCovers.length > 0) ? covers : null
}

export const presentWinterCovers = (
  covers: YearCover[][],
): WinterCoverDefinition[] =>
  WINTER_COVERS.filter((cover) =>
    covers.some((yearCovers) =>
      yearCovers.some((yearCover) => yearCover.cover === cover),
    ),
  )
