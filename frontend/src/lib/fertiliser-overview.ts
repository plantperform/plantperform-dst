import type {
  FieldRecord,
  FieldYearValues,
  RotationCandidateYearResult,
} from '@/api/types'
import { yearResultHasValues } from '@/lib/field-domain'

// A mark's gødning per hectare, for one year or as the average per year over
// its sædskifte.
export type FertiliserFigures = {
  cropNormKgNHa: number | null
  precedingCropValueKgNHa: number
  mineralFertiliserKgNHa: number
  // The utilised part of the manure, which counts toward the norm like
  // handelsgødning.
  manureUtilisedKgNHa: number
  // The organically bound part, which does not count toward the norm.
  manureOrganicBoundKgNHa: number
  manureTonsPerHa: number
}

const yearFertiliser = (
  yearResult: RotationCandidateYearResult,
): FertiliserFigures => ({
  cropNormKgNHa: yearResult.cropNormKgNHa,
  precedingCropValueKgNHa: yearResult.precedingCropValueKgNHa,
  mineralFertiliserKgNHa: yearResult.appliedMineralFertiliserKgNHa,
  manureUtilisedKgNHa: yearResult.appliedManureUtilisedKgNHa,
  manureOrganicBoundKgNHa: yearResult.manureOrganicBoundKgNHa,
  manureTonsPerHa: yearResult.manureTonsPerHa,
})

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length

// The selected year, or the average over the years with values. The average
// norm is null when a counted year has no norm: a missing norm is a gap in the
// data, not a norm of 0.
export const fieldFertiliser = (
  years: RotationCandidateYearResult[] | undefined,
  yearIndex: number | null,
): FertiliserFigures | null => {
  if (!years) return null
  const candidates =
    yearIndex === null ? years : years.slice(yearIndex, yearIndex + 1)
  const counted = candidates.filter(yearResultHasValues).map(yearFertiliser)
  if (counted.length === 0) return null
  const norms = counted.map((figures) => figures.cropNormKgNHa)
  const average = (pick: (figures: FertiliserFigures) => number) =>
    mean(counted.map(pick))
  return {
    cropNormKgNHa: norms.every((norm): norm is number => norm !== null)
      ? mean(norms)
      : null,
    precedingCropValueKgNHa: average((f) => f.precedingCropValueKgNHa),
    mineralFertiliserKgNHa: average((f) => f.mineralFertiliserKgNHa),
    manureUtilisedKgNHa: average((f) => f.manureUtilisedKgNHa),
    manureOrganicBoundKgNHa: average((f) => f.manureOrganicBoundKgNHa),
    manureTonsPerHa: average((f) => f.manureTonsPerHa),
  }
}

export const fertiliserByFieldId = (
  fields: FieldRecord[],
  yearsByFieldId: FieldYearValues | undefined,
  yearIndex: number | null,
): Map<string, FertiliserFigures> => {
  const byFieldId = new Map<string, FertiliserFigures>()
  for (const field of fields) {
    const figures = fieldFertiliser(yearsByFieldId?.[field.id], yearIndex)
    if (figures) byFieldId.set(field.id, figures)
  }
  return byFieldId
}

// Forfrugt plus the tildelt N that counts toward the norm.
export const availableNKgNHa = (figures: FertiliserFigures): number =>
  figures.precedingCropValueKgNHa +
  figures.mineralFertiliserKgNHa +
  figures.manureUtilisedKgNHa

export const availableNShareOfNorm = (
  figures: FertiliserFigures,
): number | null =>
  figures.cropNormKgNHa ? availableNKgNHa(figures) / figures.cropNormKgNHa : null

export type FertiliserTotal = {
  // The figure times the area, summed over the marker that have it.
  amount: number
  areaHa: number
}

export const totalFertiliser = (
  fields: FieldRecord[],
  byFieldId: Map<string, FertiliserFigures>,
  pick: (figures: FertiliserFigures) => number | null,
): FertiliserTotal | null => {
  let amount = 0
  let areaHa = 0
  for (const field of fields) {
    const figures = byFieldId.get(field.id)
    const value = figures ? pick(figures) : null
    if (value === null) continue
    amount += value * field.areaHa
    areaHa += field.areaHa
  }
  return areaHa > 0 ? { amount, areaHa } : null
}
