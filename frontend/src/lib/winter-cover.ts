import type { RotationYear } from '@/api/types'

export type WinterCoverKind =
  | 'catchCrop'
  | 'intermediateCrop'
  | 'cropCover'
  | 'stubble'
  | 'bareSoil'
  | 'earlySowing'

export type WinterCoverDefinition = {
  id: WinterCoverKind
  label: string
  description: string
  color: string
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

const CROP_COVER: WinterCoverDefinition = {
  id: 'cropCover',
  label: 'Plantedække',
  description: 'En afgrøde dækker jorden vinteren over.',
  color: '#2563eb',
}

const STUBBLE: WinterCoverDefinition = {
  id: 'stubble',
  label: 'Stubmark',
  description:
    'Stubben står urørt, og kun ukrudt og spildkorn dækker jorden vinteren over.',
  color: '#f97316',
}

const BARE_SOIL: WinterCoverDefinition = {
  id: 'bareSoil',
  label: 'Bar jord',
  description: 'Jorden er bearbejdet og ligger uden plantedække vinteren over.',
  color: '#d6d3d1',
}

export const EARLY_SOWING: WinterCoverDefinition = {
  id: 'earlySowing',
  label: 'Tidlig såning',
  description:
    'Vintersæden er sået tidligt, så den optager kvælstof i efteråret.',
  color: '#6d28d9',
}

const WINTER_COVERS: readonly WinterCoverDefinition[] = [
  CATCH_CROP,
  INTERMEDIATE_CROP,
  CROP_COVER,
  STUBBLE,
  BARE_SOIL,
  EARLY_SOWING,
]

const yearCover = (
  cover: WinterCoverDefinition,
  description = cover.description,
): YearCover => ({ cover, description })

const W_COVERS: Record<number, YearCover> = {
  1: yearCover(CROP_COVER, 'Vintersæd dækker jorden vinteren over.'),
  2: yearCover(BARE_SOIL, 'Jorden ligger bar vinteren over.'),
  3: yearCover(
    BARE_SOIL,
    'Efter majs eller kartofler ligger jorden bar vinteren over.',
  ),
  4: yearCover(
    CROP_COVER,
    'Efterafgrøder, undersået græs eller brak dækker jorden vinteren over.',
  ),
  5: yearCover(
    STUBBLE,
    'Stubben står urørt, og kun ukrudt og spildkorn dækker jorden vinteren over.',
  ),
  6: yearCover(
    CROP_COVER,
    'Græs, kløvergræs, vinterraps eller roer står på marken langt ind i efteråret.',
  ),
  7: yearCover(CROP_COVER, 'Vintersæd efter græs dækker jorden vinteren over.'),
  8: yearCover(
    CROP_COVER,
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
  const state = isOn(detail.EEA)
    ? yearCover(CATCH_CROP)
    : isOn(detail.EMA)
      ? yearCover(INTERMEDIATE_CROP)
      : yearCoverForW(Number(detail.W_used ?? detail.W))
  const covers = state ? [state] : []
  if (isOn(detail.ETS)) covers.push(yearCover(EARLY_SOWING))
  return covers
}

const yearCoversFromUndersownCrop = (code: number | null): YearCover[] => {
  if (code === null) return []
  if (CATCH_CROP_CODES.has(code)) return [yearCover(CATCH_CROP)]
  if (INTERMEDIATE_CROP_CODES.has(code)) return [yearCover(INTERMEDIATE_CROP)]
  if (code === EARLY_SOWING_CODE) return [yearCover(EARLY_SOWING)]
  if (UNDERSOWN_COVER_CODES.has(code)) {
    return [
      yearCover(
        CROP_COVER,
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
      : yearCoversFromUndersownCrop(year.undersownCropCode)
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
