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

export type CropGroupDefinition = {
  id: CropGroup
  label: string
  color: string
}

export const CROP_GROUPS: readonly CropGroupDefinition[] = [
  { id: 'springCereal', label: 'Vårsæd', color: '#d9a441' },
  { id: 'winterCereal', label: 'Vintersæd', color: '#a86b2c' },
  { id: 'maize', label: 'Majs', color: '#e8702a' },
  { id: 'oilseed', label: 'Raps og olie', color: '#f2e04a' },
  { id: 'legume', label: 'Bælgsæd', color: '#8d6bcf' },
  { id: 'potato', label: 'Kartofler', color: '#8a5a3c' },
  { id: 'beet', label: 'Roer og industri', color: '#d4679a' },
  { id: 'seedGrass', label: 'Frøgræs', color: '#a5d16a' },
  { id: 'grass', label: 'Græs', color: '#3f9155' },
  { id: 'fallow', label: 'Brak og natur', color: '#7fa08a' },
  { id: 'other', label: 'Andet', color: '#c4c4c4' },
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
