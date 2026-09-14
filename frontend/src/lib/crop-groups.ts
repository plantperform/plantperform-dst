export type CropGroup =
  | 'springCereal'
  | 'winterCereal'
  | 'maize'
  | 'oilseed'
  | 'legume'
  | 'potato'
  | 'beet'
  | 'seedGrass'
  | 'grass'
  | 'fallow'
  | 'other'

export type CropGroupPattern = 'solid' | 'stripes' | 'dots'

export type CropGroupDefinition = {
  id: CropGroup
  label: string
  color: string
  pattern: CropGroupPattern
}

export const CROP_GROUPS: readonly CropGroupDefinition[] = [
  { id: 'springCereal', label: 'Vårsæd', color: '#d9a23a', pattern: 'solid' },
  {
    id: 'winterCereal',
    label: 'Vintersæd',
    color: '#7a4b14',
    pattern: 'stripes',
  },
  { id: 'maize', label: 'Majs', color: '#f07a2a', pattern: 'solid' },
  { id: 'oilseed', label: 'Raps og olie', color: '#fae62e', pattern: 'solid' },
  { id: 'legume', label: 'Bælgsæd', color: '#7a52c9', pattern: 'solid' },
  { id: 'potato', label: 'Kartofler', color: '#d4487e', pattern: 'dots' },
  {
    id: 'beet',
    label: 'Roer og industri',
    color: '#3a86d6',
    pattern: 'solid',
  },
  { id: 'seedGrass', label: 'Frøgræs', color: '#9ccb4b', pattern: 'stripes' },
  { id: 'grass', label: 'Græs', color: '#237a3e', pattern: 'solid' },
  {
    id: 'fallow',
    label: 'Brak og natur',
    color: '#4cc2b5',
    pattern: 'solid',
  },
  { id: 'other', label: 'Andet', color: '#c0c4ca', pattern: 'solid' },
]

const groupById = new Map<CropGroup, CropGroupDefinition>(
  CROP_GROUPS.map((group) => [group.id, group]),
)

export const CROP_GROUP_INDEX: Record<CropGroup, number> = Object.fromEntries(
  CROP_GROUPS.map((group, index) => [group.id, index]),
) as Record<CropGroup, number>

type CodeRange = [from: number, to: number, group: CropGroup]

const CODE_RANGES: readonly CodeRange[] = [
  [1, 4, 'springCereal'],
  [5, 5, 'maize'],
  [6, 6, 'springCereal'],
  [7, 7, 'legume'],
  [8, 8, 'springCereal'],
  [9, 17, 'winterCereal'],
  [18, 18, 'legume'],
  [19, 19, 'maize'],
  [21, 24, 'oilseed'],
  [25, 27, 'legume'],
  [30, 32, 'legume'],
  [35, 36, 'legume'],
  [40, 42, 'oilseed'],
  [51, 51, 'oilseed'],
  [52, 53, 'springCereal'],
  [54, 54, 'legume'],
  [55, 56, 'springCereal'],
  [57, 57, 'winterCereal'],
  [58, 58, 'maize'],
  [101, 120, 'seedGrass'],
  [121, 121, 'legume'],
  [125, 125, 'beet'],
  [149, 157, 'potato'],
  [160, 162, 'beet'],
  [170, 299, 'grass'],
  [300, 329, 'fallow'],
]

type KeywordRule = [keywords: readonly string[], group: CropGroup]

const KEYWORD_RULES: readonly KeywordRule[] = [
  [['kartof'], 'potato'],
  [['roe', 'cikorie'], 'beet'],
  [['majs', 'sorghum'], 'maize'],
  [['raps', 'rybs', 'hør', 'hamp', 'solsikke'], 'oilseed'],
  [['ært', 'bønne', 'lupin', 'bælg', 'linse', 'kikært', 'soja'], 'legume'],
  [['frø'], 'seedGrass'],
  [['brak', 'udyrket', 'natur', 'vildt'], 'fallow'],
  [['græs', 'kløver'], 'grass'],
  [['vinter'], 'winterCereal'],
  [
    [
      'vår',
      'byg',
      'hvede',
      'havre',
      'rug',
      'spelt',
      'triticale',
      'quinoa',
      'boghvede',
      'korn',
    ],
    'springCereal',
  ],
]

const groupFromCode = (afgrodeKode: number): CropGroup | null => {
  if (!Number.isFinite(afgrodeKode) || afgrodeKode <= 0) return null
  for (const [from, to, group] of CODE_RANGES) {
    if (afgrodeKode >= from && afgrodeKode <= to) return group
  }
  return null
}

const groupFromName = (afgrodeNavn: string): CropGroup => {
  const name = afgrodeNavn.toLocaleLowerCase('da-DK')
  for (const [keywords, group] of KEYWORD_RULES) {
    if (keywords.some((keyword) => name.includes(keyword))) return group
  }
  return 'other'
}

export const classifyCrop = (
  afgrodeKode: number,
  afgrodeNavn: string,
): CropGroup => groupFromCode(afgrodeKode) ?? groupFromName(afgrodeNavn)

export const cropGroupDefinition = (group: CropGroup): CropGroupDefinition =>
  groupById.get(group) ?? CROP_GROUPS[CROP_GROUPS.length - 1]

export const cropGroupColor = (
  afgrodeKode: number,
  afgrodeNavn: string,
): string => cropGroupDefinition(classifyCrop(afgrodeKode, afgrodeNavn)).color

export const cropGroupPattern = (
  afgrodeKode: number,
  afgrodeNavn: string,
): CropGroupPattern =>
  cropGroupDefinition(classifyCrop(afgrodeKode, afgrodeNavn)).pattern

export const cropGroupLabel = (
  afgrodeKode: number,
  afgrodeNavn: string,
): string => cropGroupDefinition(classifyCrop(afgrodeKode, afgrodeNavn)).label

export const presentCropGroups = (
  crops: { afgrodeKode: number; afgrodeNavn: string }[],
): CropGroupDefinition[] => {
  const present = new Set<CropGroup>(
    crops.map((crop) => classifyCrop(crop.afgrodeKode, crop.afgrodeNavn)),
  )
  return CROP_GROUPS.filter((group) => present.has(group.id))
}

const DARK_TEXT = '#1a2821'
const LIGHT_TEXT = '#faf9f5'

export const readableTextColor = (hex: string): string => {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55 ? DARK_TEXT : LIGHT_TEXT
}

export const shortCropName = (name: string): string =>
  name.split(/[,(]/)[0].trim()
