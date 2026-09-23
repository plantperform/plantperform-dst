import { BRAND_COLORS, UI_COLORS } from '@/lib/brand-colors'

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

// Crop colours come from the ICOEL palette, whose accent colours the guide
// reserves for crops. Chosen to stay apart (CIEDE2000 >= 13) for normal vision
// and for simulated deuteranopia and protanopia.
export const CROP_GROUPS: readonly CropGroupDefinition[] = [
  {
    id: 'springCereal',
    label: 'Vårsæd',
    color: '#FAECB8', // Sol 50 %
  },
  {
    id: 'winterCereal',
    label: 'Vintersæd',
    color: BRAND_COLORS.soil,
  },
  {
    id: 'maize',
    label: 'Majs',
    color: BRAND_COLORS.carrot,
  },
  {
    id: 'oilseed',
    label: 'Raps og olie',
    color: BRAND_COLORS.rapeseed,
  },
  {
    id: 'legume',
    label: 'Bælgsæd',
    color: BRAND_COLORS.waterTertiary,
  },
  {
    id: 'potato',
    label: 'Kartofler',
    color: BRAND_COLORS.redBrown,
  },
  {
    id: 'beet',
    label: 'Roer og industri',
    color: BRAND_COLORS.berry,
  },
  {
    id: 'seedGrass',
    label: 'Frøgræs',
    color: BRAND_COLORS.forestTertiary,
  },
  {
    id: 'grass',
    label: 'Græs',
    color: '#90AA81', // Skov 75 %
  },
  {
    id: 'fallow',
    label: 'Brak og natur',
    color: '#AECAC5', // Tertiær skov 50 %
  },
  {
    id: 'other',
    label: 'Andet',
    color: '#A0C2E2', // Tertiær vand 50 %
  },
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

const groupFromCode = (cropCode: number): CropGroup | null => {
  if (!Number.isFinite(cropCode) || cropCode <= 0) return null
  for (const [from, to, group] of CODE_RANGES) {
    if (cropCode >= from && cropCode <= to) return group
  }
  return null
}

const groupFromName = (cropName: string): CropGroup => {
  const name = cropName.toLocaleLowerCase('da-DK')
  for (const [keywords, group] of KEYWORD_RULES) {
    if (keywords.some((keyword) => name.includes(keyword))) return group
  }
  return 'other'
}

export const classifyCrop = (cropCode: number, cropName: string): CropGroup =>
  groupFromCode(cropCode) ?? groupFromName(cropName)

export const cropGroupDefinition = (group: CropGroup): CropGroupDefinition =>
  groupById.get(group) ?? CROP_GROUPS[CROP_GROUPS.length - 1]

export const cropGroupFor = (
  cropCode: number,
  cropName: string,
): CropGroupDefinition => cropGroupDefinition(classifyCrop(cropCode, cropName))

export const cropGroupColor = (cropCode: number, cropName: string): string =>
  cropGroupDefinition(classifyCrop(cropCode, cropName)).color

export const presentCropGroups = (
  crops: { cropCode: number; cropName: string }[],
): CropGroupDefinition[] => {
  const present = new Set<CropGroup>(
    crops.map((crop) => classifyCrop(crop.cropCode, crop.cropName)),
  )
  return CROP_GROUPS.filter((group) => present.has(group.id))
}

const DARK_TEXT = UI_COLORS.ink
const LIGHT_TEXT = '#ffffff'

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
