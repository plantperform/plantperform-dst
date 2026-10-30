import type {
  FieldRecord,
  RotationCategoryOption,
  RotationOption,
} from '@/api/types'

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
