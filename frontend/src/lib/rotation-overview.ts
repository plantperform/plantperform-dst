import type {
  FieldRecord,
  RotationCategoryOption,
  RotationOption,
} from '@/api/types'
import { BRAND_COLORS } from '@/lib/brand-colors'

// The backend uses "permanent" as the rotation number of permanent crops.
export const PERMANENT_ROTATION = 'permanent'

// Stands for the fields without a rotation wherever a rotation is a key or a
// map property. No rotation number is ever "none".
export const NO_ROTATION_KEY = 'none'

export type RotationShare = {
  // Null for the fields that have no rotation selected.
  rotationVariant: string | null
  cropSequence: string[] | null
  areaHa: number
  share: number
  fieldCount: number
}

// A field's rotationId is "<rotationVariant>:<variant>:<nNormPct>" ("315:4:80").
// The rotation is the first part; the variant and N-norm only tell candidates
// of the same rotation apart.
export const rotationVariantOf = (rotationId: string): string =>
  rotationId.split(':')[0]

export const rotationKey = (rotationVariant: string | null): string =>
  rotationVariant ?? NO_ROTATION_KEY

export const rotationLabel = (rotationVariant: string | null): string =>
  rotationVariant === null
    ? 'Uden sædskifte'
    : rotationVariant === PERMANENT_ROTATION
      ? 'Permanente sædskifter'
      : `Sædskifte ${rotationVariant}`

// The crops of a rotation in the order of the years: "1. Vinterhvede → 2. Vårbyg".
export const cropSequenceText = (cropSequence: string[]): string =>
  cropSequence.map((crop, index) => `${index + 1}. ${crop}`).join(' → ')

// A rotation can be listed under more than one category; keep the first.
export const rotationOptionsOf = (
  categories: RotationCategoryOption[],
): RotationOption[] => {
  const byVariant = new Map<string, RotationOption>()
  for (const category of categories) {
    for (const rotation of category.rotations) {
      if (!byVariant.has(rotation.rotationVariant)) {
        byVariant.set(rotation.rotationVariant, rotation)
      }
    }
  }
  return [...byVariant.values()]
}

export const summarizeRotationDistribution = (
  fields: FieldRecord[],
  rotations: RotationOption[],
): RotationShare[] => {
  const sequenceByVariant = new Map(
    rotations.map((rotation) => [
      rotation.rotationVariant,
      rotation.cropSequence,
    ]),
  )
  const totalsByVariant = new Map<
    string | null,
    { areaHa: number; fieldCount: number }
  >()
  let totalHa = 0
  for (const field of fields) {
    const variant =
      field.rotationId === null ? null : rotationVariantOf(field.rotationId)
    const totals = totalsByVariant.get(variant) ?? { areaHa: 0, fieldCount: 0 }
    totals.areaHa += field.areaHa
    totals.fieldCount += 1
    totalHa += field.areaHa
    totalsByVariant.set(variant, totals)
  }

  const shares = [...totalsByVariant].map(
    ([rotationVariant, totals]): RotationShare => ({
      rotationVariant,
      cropSequence:
        rotationVariant === null
          ? null
          : (sequenceByVariant.get(rotationVariant) ?? null),
      areaHa: totals.areaHa,
      share: totalHa > 0 ? totals.areaHa / totalHa : 0,
      fieldCount: totals.fieldCount,
    }),
  )

  // The fields without a rotation always come last, whatever their area.
  return shares.sort((left, right) => {
    if (left.rotationVariant === null) return 1
    if (right.rotationVariant === null) return -1
    return (
      right.areaHa - left.areaHa ||
      left.rotationVariant.localeCompare(right.rotationVariant, 'da', {
        numeric: true,
      })
    )
  })
}

// The crops of the rotation a field follows, null when the field has no
// rotation or the rotation is not among the options.
export const cropSequenceOf = (
  rotationId: string | null,
  shares: RotationShare[],
): string[] | null => {
  if (rotationId === null) return null
  const rotationVariant = rotationVariantOf(rotationId)
  return (
    shares.find((share) => share.rotationVariant === rotationVariant)
      ?.cropSequence ?? null
  )
}

const ROTATION_COLORS = [
  BRAND_COLORS.water,
  BRAND_COLORS.forest,
  BRAND_COLORS.carrot,
  BRAND_COLORS.berry,
  BRAND_COLORS.waterTertiary,
  BRAND_COLORS.soil,
  BRAND_COLORS.forestTertiary,
  BRAND_COLORS.sun,
  BRAND_COLORS.redBrown,
  BRAND_COLORS.freshGreen,
]
export const NO_ROTATION_COLOR = '#B8B2A7'

// The colours go to the rotations in the order of the shares, so the largest
// rotation gets the first one. Hand it the shares of the whole farm, not of one
// opland: the donut and the map then show a rotation in the same colour whatever
// the scope. With more rotations than colours the colours start over.
export const rotationColorsOf = (
  shares: RotationShare[],
): Map<string, string> => {
  const colors = new Map<string, string>()
  let next = 0
  for (const share of shares) {
    colors.set(
      rotationKey(share.rotationVariant),
      share.rotationVariant === null
        ? NO_ROTATION_COLOR
        : ROTATION_COLORS[next++ % ROTATION_COLORS.length],
    )
  }
  return colors
}
