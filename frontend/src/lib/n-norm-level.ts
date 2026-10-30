import type {
  DisplayYearValue,
  FieldRecord,
  FieldYearValues,
} from '@/api/types'
import {
  fieldNNormPct,
  formatNumber,
  yearResultHasValues,
} from '@/lib/field-domain'

// What the N-norm level means for a mark: only afgrøder with a norm and a
// yield-response curve are fertilised below the norm. The rest get the full
// norm whatever level the candidate carries, or no N at all.
export type NNormLevel =
  // No norm for the afgrøde (brak): nothing is applied.
  | { kind: 'noNorm' }
  // A norm but no yield-response curve: fertilised at 100 %.
  | { kind: 'fullNorm' }
  | { kind: 'level'; pct: number }
  // Only some of the years have a curve, and the level applies to those.
  | { kind: 'partial'; pct: number; responseYears: number; years: number }

export type NNormLevelText = {
  value: string
  // A second line under the value.
  note?: string
  tooltip?: string
  muted?: boolean
}

// A year without the flag (a read model prepared before the backend sent it)
// counts as having a curve, which is how the level was shown before.
const yearHasResponse = (year: DisplayYearValue): boolean | null => {
  const flag =
    'dbDetail' in year ? year.dbDetail.hasYieldResponse : year.hasYieldResponse
  return typeof flag === 'boolean' ? flag : null
}

const hasNorm = (year: DisplayYearValue): boolean =>
  (year.cropNormKgNHa ?? 0) > 0

// The level over the given years, or the one in the candidate ID when the
// years are not loaded. Null when none of the years has values.
export const nNormLevelOf = (
  years: DisplayYearValue[] | undefined,
  fallbackPct: number | null,
): NNormLevel | null => {
  if (years === undefined) {
    return fallbackPct === null ? null : { kind: 'level', pct: fallbackPct }
  }
  const counted = years.filter(yearResultHasValues)
  if (counted.length === 0) return null
  const withNorm = counted.filter(hasNorm)
  if (withNorm.length === 0) return { kind: 'noNorm' }
  const responding = withNorm.filter((year) => yearHasResponse(year) !== false)
  if (responding.length === 0) return { kind: 'fullNorm' }
  const pct = responding[0].nNormPct
  return responding.length === counted.length
    ? { kind: 'level', pct }
    : {
        kind: 'partial',
        pct,
        responseYears: responding.length,
        years: counted.length,
      }
}

// The selected year, or all the years of the sædskifte.
export const nNormLevelByFieldId = (
  fields: FieldRecord[],
  yearsByFieldId: FieldYearValues | undefined,
  yearIndex: number | null,
): Map<string, NNormLevel> => {
  const byFieldId = new Map<string, NNormLevel>()
  for (const field of fields) {
    const years = yearsByFieldId?.[field.id]
    const selected =
      years === undefined || yearIndex === null
        ? years
        : years.slice(yearIndex, yearIndex + 1)
    const level = nNormLevelOf(selected, fieldNNormPct(field))
    if (level) byFieldId.set(field.id, level)
  }
  return byFieldId
}

// The number the column sorts by, which is the one it shows. Null sorts last.
export const nNormLevelSortValue = (level: NNormLevel): number | null => {
  switch (level.kind) {
    case 'noNorm':
      return null
    case 'fullNorm':
      return 100
    case 'level':
    case 'partial':
      return level.pct
  }
}

// The number for a mark, or the one in the candidate ID when the list has not
// worked out the level for it.
export const fieldNNormSortValue = (
  field: FieldRecord,
  levels: Map<string, NNormLevel> | undefined,
): number | null => {
  const level = levels?.get(field.id)
  return level ? nNormLevelSortValue(level) : fieldNNormPct(field)
}

export const describeNNormLevel = (level: NNormLevel): NNormLevelText => {
  switch (level.kind) {
    case 'noNorm':
      return {
        value: '-',
        muted: true,
        tooltip: 'Afgrøden har ingen N-norm, så N-norm% har ingen betydning.',
      }
    case 'fullNorm':
      return {
        value: '100 %',
        note: 'ingen udbyttekurve',
        tooltip:
          'Afgrøden har ingen udbyttekurve og gødskes til fuld norm, uanset N-norm%.',
      }
    case 'level':
      return { value: `${formatNumber(level.pct)} %` }
    case 'partial': {
      const years = `${level.responseYears} af ${level.years} år`
      return {
        value: `${formatNumber(level.pct)} %`,
        note: years,
        tooltip: `${formatNumber(level.pct)} % gælder de ${years}, hvor afgrøden har en udbyttekurve. Øvrige år gødskes til fuld norm eller har ingen norm.`,
      }
    }
  }
}

// Under the N-norm choices of the manual editor, when the choice does not
// reach every year of the sædskifte.
export const nNormLevelNote = (level: NNormLevel | null): string | null => {
  if (level === null) return null
  switch (level.kind) {
    case 'noNorm':
      return 'Ingen afgrøder i dette sædskifte har en N-norm, så valget har ingen effekt.'
    case 'fullNorm':
      return 'Ingen afgrøder i dette sædskifte har en udbyttekurve, så valget har ingen effekt. Alle år gødskes til fuld norm.'
    case 'partial':
      return `Valget gælder kun de ${level.responseYears} af ${level.years} år med udbyttekurve.`
    default:
      return null
  }
}
