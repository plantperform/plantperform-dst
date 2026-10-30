import type { FieldRecord, FieldYearValues } from '@/api/types'
import { yearResultHasValues } from '@/lib/field-domain'
import {
  rotationCovers,
  winterCoverDefinition,
  type WinterCoverKind,
} from '@/lib/winter-cover'

export type WinterCoverBucket = {
  id: WinterCoverKind
  label: string
  description: string
  color: string
}

// One slice per kind of vinterdække, in the order they win when a year has
// more than one: the measures first. Tidlig såning comes with another cover
// (vintersæd), so a year with both counts as tidlig såning. Stub is the cover
// of a mark without any of the measures, so it only counts the area that has
// no efterafgrøde. The history cannot tell mellemafgrøde and tidlig såning
// apart, so that has a slice of its own.
const BUCKET_ORDER: readonly WinterCoverKind[] = [
  'catchCrop',
  'intermediateCrop',
  'earlySowing',
  'intermediateOrEarlySowing',
  'stubble',
  'winterCereal',
  'grassRapeBeets',
  'undersownOrFallow',
  'bareSoil',
]

// The colour and the definition are the ones of the band under the crops. The
// one of two measures is split in the band, so the ring blends the two.
const COLOR_OVERRIDES: Partial<Record<WinterCoverKind, string>> = {
  intermediateOrEarlySowing: '#a428a8',
}

export const WINTER_COVER_BUCKETS: readonly WinterCoverBucket[] =
  BUCKET_ORDER.map((id) => {
    const { label, description, color } = winterCoverDefinition(id)
    return { id, label, description, color: COLOR_OVERRIDES[id] ?? color }
  })

export type WinterCoverShare = WinterCoverBucket & {
  areaHa: number
  share: number
}

const bucketOf = (kinds: WinterCoverKind[]): WinterCoverKind | null =>
  BUCKET_ORDER.find((kind) => kinds.includes(kind)) ?? null

// Area per kind of vinterdække for a year, or the average over the years.
// Weighted like summarizeCropDistribution, so the two rings of the donut
// cover the same area. Years where the cover is unknown count for nothing, so
// the shares are of the area with a known cover.
export const summarizeWinterCover = (
  fields: FieldRecord[],
  yearsByFieldId: FieldYearValues | undefined,
  yearIndex: number | null,
): WinterCoverShare[] => {
  const areaById = new Map<WinterCoverKind, number>()
  let totalHa = 0
  for (const field of fields) {
    const years = yearsByFieldId?.[field.id]
    if (!years) continue
    const indexes = years
      .map((_, index) => index)
      .filter(
        (index) =>
          (yearIndex === null || index === yearIndex) &&
          yearResultHasValues(years[index]),
      )
    if (indexes.length === 0) continue
    const areaPerYear = field.areaHa / indexes.length
    for (const index of indexes) {
      const yearResult = years[index]
      const detail =
        'winterCover' in yearResult
          ? yearResult.winterCover
          : yearResult.leachingDetail
      const covers = rotationCovers([yearResult.year], [detail])?.[0] ?? []
      const bucket = bucketOf(covers.map(({ cover }) => cover.id))
      if (bucket === null) continue
      areaById.set(bucket, (areaById.get(bucket) ?? 0) + areaPerYear)
      totalHa += areaPerYear
    }
  }
  if (totalHa === 0) return []
  return WINTER_COVER_BUCKETS.flatMap((bucket) => {
    const areaHa = areaById.get(bucket.id) ?? 0
    return areaHa > 0 ? [{ ...bucket, areaHa, share: areaHa / totalHa }] : []
  })
}
