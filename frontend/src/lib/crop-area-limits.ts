import type { CropAreaLimit, CropAreaRange, FieldRecord } from '@/api/types'
import { NUM_ROTATION_YEARS, ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'
import { parseDecimalInput } from '@/lib/number-input'

export type AreaUnit = 'ha' | '%'

export type CropAreaLimitInput = {
  cropCode: number
  min: string
  max: string
  unit: AreaUnit
}

export type CropAreaLimitDraft = {
  cropCode: number
  minHa: string
  maxHa: string
}

const areaFormat = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 })

const isNumber = (value: number | null): value is number =>
  value !== null && !Number.isNaN(value)

export const totalFieldAreaHa = (fields: FieldRecord[]) =>
  fields.reduce((total, field) => total + field.areaHa, 0)

const areaToInput = (value: number | null) =>
  value === null ? '' : String(value)

export const inputFromCropAreaLimit = (
  limit: CropAreaLimit,
): CropAreaLimitInput => ({
  cropCode: limit.cropCode,
  min: areaToInput(limit.minAreaHa),
  max: areaToInput(limit.maxAreaHa),
  unit: 'ha',
})

export const emptyCropAreaLimitInput = (
  cropCode: number,
): CropAreaLimitInput => ({ cropCode, min: '', max: '', unit: 'ha' })

const percentToHectares = (value: string, totalAreaHa: number) => {
  const percent = parseDecimalInput(value)
  return isNumber(percent) ? String((percent / 100) * totalAreaHa) : value
}

export const hectareDraft = (
  input: CropAreaLimitInput,
  totalAreaHa: number,
): CropAreaLimitDraft =>
  input.unit === 'ha'
    ? { cropCode: input.cropCode, minHa: input.min, maxHa: input.max }
    : {
        cropCode: input.cropCode,
        minHa: percentToHectares(input.min, totalAreaHa),
        maxHa: percentToHectares(input.max, totalAreaHa),
      }

type CropAreaLimitParts = {
  prefix: string | null
  amount: string
  unit: AreaUnit
}

export const cropAreaLimitParts = (
  input: CropAreaLimitInput,
): CropAreaLimitParts | null => {
  const min = parseDecimalInput(input.min)
  const max = parseDecimalInput(input.max)
  const { unit } = input
  if (isNumber(min) && isNumber(max)) {
    return {
      prefix: null,
      amount: `${areaFormat.format(min)}–${areaFormat.format(max)}`,
      unit,
    }
  }
  if (isNumber(min)) {
    return { prefix: 'mindst', amount: areaFormat.format(min), unit }
  }
  if (isNumber(max)) {
    return { prefix: 'højst', amount: areaFormat.format(max), unit }
  }
  return null
}

export const isEmptyCropAreaLimit = (draft: CropAreaLimitDraft) =>
  draft.minHa.trim() === '' && draft.maxHa.trim() === ''

export const cropAreaLimitError = (
  draft: CropAreaLimitDraft,
): string | null => {
  const min = parseDecimalInput(draft.minHa)
  const max = parseDecimalInput(draft.maxHa)
  if (Number.isNaN(min) || Number.isNaN(max)) return 'Skriv et tal.'
  if (min === null && max === null) return 'Angiv et minimum eller et maksimum.'
  if ((min !== null && min < 0) || (max !== null && max < 0)) {
    return 'Arealet kan ikke være negativt.'
  }
  if (min !== null && max !== null && min > max) {
    return 'Min. er større end maks.'
  }
  return null
}

export const cropAreaLimitFromDraft = (
  draft: CropAreaLimitDraft,
): CropAreaLimit => ({
  cropCode: draft.cropCode,
  minAreaHa: parseDecimalInput(draft.minHa),
  maxAreaHa: parseDecimalInput(draft.maxHa),
})

export const sameCropAreaLimits = (
  left: CropAreaLimit[],
  right: CropAreaLimit[],
) =>
  left.length === right.length &&
  left.every(
    (limit, index) =>
      limit.cropCode === right[index].cropCode &&
      limit.minAreaHa === right[index].minAreaHa &&
      limit.maxAreaHa === right[index].maxAreaHa,
  )

export const currentCropAreaHa = (
  fields: FieldRecord[],
  cropCode: number,
): number => {
  let totalHa = 0
  for (const field of fields) {
    const rotation = field.cropRotation
    if (rotation.length === 0) continue
    for (let year = 0; year < NUM_ROTATION_YEARS; year += 1) {
      if (rotation[year % rotation.length].cropCode === cropCode) {
        totalHa += field.areaHa
      }
    }
  }
  return totalHa / NUM_ROTATION_YEARS
}

export const currentCropAreaLabel = (areaHa: number) =>
  `Nuværende ${areaFormat.format(areaHa)} ha`

export type FieldAreaSums = {
  reachable: Uint8Array
  toleranceUnits: number
}

const SUM_UNITS_PER_HA = 100
const MAX_SUM_WORK = 20_000_000

export const fieldAreaSums = (fields: FieldRecord[]): FieldAreaSums | null => {
  const units = fields
    .map((field) => Math.round(field.areaHa * SUM_UNITS_PER_HA))
    .filter((unit) => unit > 0)
  const totalUnits = units.reduce((total, unit) => total + unit, 0)
  if (totalUnits * units.length > MAX_SUM_WORK) return null
  const reachable = new Uint8Array(totalUnits + 1)
  reachable[0] = 1
  let reachedUnits = 0
  for (const unit of units) {
    for (let sum = reachedUnits; sum >= 0; sum--) {
      if (reachable[sum]) reachable[sum + unit] = 1
    }
    reachedUnits += unit
  }
  return { reachable, toleranceUnits: Math.ceil(units.length / 2) }
}

const hasSumBetween = (sums: FieldAreaSums, minHa: number, maxHa: number) => {
  const from = Math.max(
    0,
    Math.floor(minHa * SUM_UNITS_PER_HA) - sums.toleranceUnits,
  )
  const to = Math.min(
    sums.reachable.length - 1,
    Math.ceil(maxHa * SUM_UNITS_PER_HA) + sums.toleranceUnits,
  )
  for (let sum = from; sum <= to; sum++) {
    if (sums.reachable[sum]) return true
  }
  return false
}

export const cropAreaLimitWarning = (
  draft: CropAreaLimitDraft,
  totalAreaHa: number,
  sums: FieldAreaSums | null,
): string | null => {
  if (cropAreaLimitError(draft) !== null) return null
  const min = parseDecimalInput(draft.minHa)
  const max = parseDecimalInput(draft.maxHa)
  if (min !== null && min > totalAreaHa) {
    return `Minimum er større end simuleringens samlede areal på ${areaFormat.format(totalAreaHa)} ha.`
  }
  if (min === null || max === null || sums === null) return null
  if (hasSumBetween(sums, min, max)) return null
  return 'Spændet kan ikke nås, fordi marker ikke deles. Gør det bredere.'
}

export const formatAreaHa = (areaHa: number) => areaFormat.format(areaHa)

const RANGE_TOLERANCE_HA = 0.005

type RunBounds = {
  highestMinHa: number
  lowestMaxHa: number
  highestMinYears: number[]
  lowestMaxYears: number[]
}

const optimizeBounds = (range: CropAreaRange): RunBounds => ({
  highestMinHa: range.maxAverageHa,
  lowestMaxHa: range.minAverageHa,
  highestMinYears: [],
  lowestMaxYears: [],
})

const yearlyBounds = (range: CropAreaRange): RunBounds => {
  const weakestYearHa = Math.min(...range.maxHaByYear)
  const strongestFloorHa = Math.max(...range.minHaByYear)
  const yearsAt = (areaByYear: number[], area: number) =>
    ROTATION_CALENDAR_YEARS.filter(
      (_, year) =>
        Math.abs((areaByYear[year] ?? 0) - area) <= RANGE_TOLERANCE_HA,
    )
  return {
    highestMinHa: Math.min(weakestYearHa, range.yearlyMaxAverageHa),
    lowestMaxHa: strongestFloorHa,
    highestMinYears:
      weakestYearHa < range.yearlyMaxAverageHa
        ? yearsAt(range.maxHaByYear, weakestYearHa)
        : [],
    lowestMaxYears:
      strongestFloorHa > 0 ? yearsAt(range.minHaByYear, strongestFloorHa) : [],
  }
}

export type PossibleCropArea = {
  lowestMaxHa: number
  highestMinHa: number
}

export const possibleCropArea = (range: CropAreaRange): PossibleCropArea => {
  const optimize = optimizeBounds(range)
  const yearly = yearlyBounds(range)
  return {
    lowestMaxHa: Math.min(optimize.lowestMaxHa, yearly.lowestMaxHa),
    highestMinHa: Math.max(optimize.highestMinHa, yearly.highestMinHa),
  }
}

export const cropAreaRangeError = (
  draft: CropAreaLimitDraft,
  range: CropAreaRange | undefined,
): string | null => {
  if (!range || cropAreaLimitError(draft) !== null) return null
  const possible = possibleCropArea(range)
  const min = parseDecimalInput(draft.minHa)
  const max = parseDecimalInput(draft.maxHa)
  if (min !== null && min > possible.highestMinHa + RANGE_TOLERANCE_HA) {
    return (
      `Højst ${areaFormat.format(possible.highestMinHa)} ha er muligt med ` +
      'simuleringens sædskifter og låste marker.'
    )
  }
  if (max !== null && max < possible.lowestMaxHa - RANGE_TOLERANCE_HA) {
    return (
      `Mindst ${areaFormat.format(possible.lowestMaxHa)} ha ligger fast med ` +
      'simuleringens sædskifter og låste marker.'
    )
  }
  return null
}

export const cropAreaRangeWarnings = (
  draft: CropAreaLimitDraft,
  range: CropAreaRange | undefined,
): string[] => {
  if (!range || cropAreaLimitError(draft) !== null) return []
  if (cropAreaRangeError(draft, range) !== null) return []
  const optimize = optimizeBounds(range)
  const yearly = yearlyBounds(range)
  const min = parseDecimalInput(draft.minHa)
  const max = parseDecimalInput(draft.maxHa)
  const warnings: string[] = []
  const inYears = (years: number[], fallback: string) =>
    years.length > 0 ? `i ${years.join(', ')}` : fallback

  if (min !== null) {
    if (min > optimize.highestMinHa + RANGE_TOLERANCE_HA) {
      warnings.push(
        'Kun Loft hvert år kan opfylde minimum - Gennemsnit for perioden kan ' +
          `højst nå ${areaFormat.format(optimize.highestMinHa)} ha i gennemsnit.`,
      )
    }
    if (min > yearly.highestMinHa + RANGE_TOLERANCE_HA) {
      warnings.push(
        'Kun Gennemsnit for perioden kan opfylde minimum - Loft hvert år kan ' +
          `højst nå ${areaFormat.format(yearly.highestMinHa)} ha ` +
          `${inYears(yearly.highestMinYears, 'hvert år')}.`,
      )
    }
  }
  if (max !== null) {
    if (max < optimize.lowestMaxHa - RANGE_TOLERANCE_HA) {
      warnings.push(
        'Kun Loft hvert år kan overholde maksimum - Gennemsnit for perioden ' +
          `har mindst ${areaFormat.format(optimize.lowestMaxHa)} ha i gennemsnit.`,
      )
    }
    if (max < yearly.lowestMaxHa - RANGE_TOLERANCE_HA) {
      warnings.push(
        'Kun Gennemsnit for perioden kan overholde maksimum - Loft hvert år ' +
          `har mindst ${areaFormat.format(yearly.lowestMaxHa)} ha ` +
          `${inYears(yearly.lowestMaxYears, 'hvert år')}.`,
      )
    }
  }
  return warnings
}

export type CropAreaViolation = {
  cropCode: number
  years: number[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const cropAreaViolationsFromDetail = (
  detail: unknown,
): CropAreaViolation[] => {
  if (!isRecord(detail) || !Array.isArray(detail.cropAreaViolations)) return []
  return detail.cropAreaViolations.flatMap((item: unknown) => {
    if (!isRecord(item)) return []
    const cropCode = item.cropCode
    if (typeof cropCode !== 'number') return []
    const years = Array.isArray(item.years)
      ? item.years.filter((year): year is number => typeof year === 'number')
      : []
    return [{ cropCode, years }]
  })
}

export const cropAreaViolationMessage = (violation: CropAreaViolation) =>
  violation.years.length === 0
    ? 'Optimeringen kan ikke opfylde kravet i gennemsnit over perioden.'
    : `Optimeringen kan ikke opfylde kravet i ${violation.years.join(', ')}.`
