import { describe, expect, it } from 'vitest'

import type {
  FieldRecord,
  FieldYearValue,
  RotationCandidateYearResult,
} from '@/api/types'
import { emptyMeasures } from '@/lib/field-domain'
import {
  describeNNormLevel,
  fieldNNormSortValue,
  nNormLevelByFieldId,
  nNormLevelNote,
  nNormLevelOf,
  nNormLevelSortValue,
} from '@/lib/n-norm-level'

const year = (overrides: Partial<FieldYearValue> = {}): FieldYearValue => ({
  year: {
    cropCode: 1,
    cropName: 'Vårbyg',
    undersownCropCode: null,
    undersownCropName: null,
  },
  leachingKgNHa: 40,
  dbDkkHa: 1000,
  precedingCropValueKgNHa: 0,
  appliedManureUtilisedKgNHa: 0,
  appliedMineralFertiliserKgNHa: 0,
  manureOrganicBoundKgNHa: 0,
  manureTonsPerHa: 0,
  cropNormKgNHa: 100,
  nNormPct: 75,
  feedUnitsPerHa: 0,
  winterCover: {},
  hasYieldResponse: true,
  ...overrides,
})

const detailedYear = (
  hasYieldResponse: unknown,
  overrides: Partial<RotationCandidateYearResult> = {},
): RotationCandidateYearResult => ({
  year: {
    cropCode: 1,
    cropName: 'Vårbyg',
    undersownCropCode: null,
    undersownCropName: null,
  },
  leachingKgNHa: 40,
  leachingDetail: {},
  dbDkkHa: 1000,
  dbDetail: { hasYieldResponse },
  precedingCropValueKgNHa: 0,
  appliedManureUtilisedKgNHa: 0,
  appliedMineralFertiliserKgNHa: 0,
  manureOrganicBoundKgNHa: 0,
  manureTonsPerHa: 0,
  cropNormKgNHa: 100,
  nNormPct: 75,
  ...overrides,
})

const brak = year({ cropNormKgNHa: null, hasYieldResponse: false })
const grass = year({ hasYieldResponse: false })
const wheat = year()

const field = (id: string, rotationId: string | null): FieldRecord => ({
  id,
  farmId: 'farm',
  imkId: null,
  catchmentId: 7,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId,
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 0,
  nLoad: 0,
  leaching: 0,
  feedUnits: 0,
  name: id,
  areaHa: 1,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
})

describe('nNormLevelOf', () => {
  it('keeps the level when every year has a curve', () => {
    expect(nNormLevelOf([wheat, wheat], null)).toEqual({
      kind: 'level',
      pct: 75,
    })
  })

  it('shows a crop with a norm but no curve as fertilised in full', () => {
    expect(nNormLevelOf([grass], 75)).toEqual({ kind: 'fullNorm' })
  })

  it('shows a crop without a norm as having no level at all', () => {
    expect(nNormLevelOf([brak], 75)).toEqual({ kind: 'noNorm' })
  })

  it('counts the years with a curve when only some have one', () => {
    expect(nNormLevelOf([wheat, grass, wheat, brak, grass], null)).toEqual({
      kind: 'partial',
      pct: 75,
      responseYears: 2,
      years: 5,
    })
  })

  it('leaves a year without a norm out of the curve years, not the total', () => {
    expect(nNormLevelOf([wheat, brak], null)).toEqual({
      kind: 'partial',
      pct: 75,
      responseYears: 1,
      years: 2,
    })
  })

  it('treats a year without the flag as having a curve', () => {
    expect(nNormLevelOf([year({ hasYieldResponse: undefined })], null)).toEqual(
      { kind: 'level', pct: 75 },
    )
    expect(nNormLevelOf([year({ hasYieldResponse: null })], null)).toEqual({
      kind: 'level',
      pct: 75,
    })
  })

  it('reads the flag from a detailed year result too', () => {
    expect(nNormLevelOf([detailedYear(false)], null)).toEqual({
      kind: 'fullNorm',
    })
    expect(nNormLevelOf([detailedYear(true)], null)).toEqual({
      kind: 'level',
      pct: 75,
    })
    expect(nNormLevelOf([detailedYear(undefined)], null)).toEqual({
      kind: 'level',
      pct: 75,
    })
  })

  it('falls back to the level in the candidate ID without years', () => {
    expect(nNormLevelOf(undefined, 85)).toEqual({ kind: 'level', pct: 85 })
    expect(nNormLevelOf(undefined, null)).toBeNull()
  })

  it('has no level for years without values', () => {
    expect(
      nNormLevelOf([year({ dbDkkHa: 0, leachingKgNHa: 0 })], 85),
    ).toBeNull()
    expect(nNormLevelOf([], 85)).toBeNull()
  })
})

describe('nNormLevelByFieldId', () => {
  const fields = [
    field('a', '1:1:75'),
    field('b', '1:1:85'),
    field('c', '1:1:100'),
  ]
  const years = {
    a: [wheat, grass, brak],
    b: [brak],
    c: [wheat, wheat, wheat],
  }

  it('follows the selected year', () => {
    const levels = nNormLevelByFieldId(fields, years, 1)
    expect(levels.get('a')).toEqual({ kind: 'fullNorm' })
    expect(levels.has('b')).toBe(false)
    expect(levels.get('c')).toEqual({ kind: 'level', pct: 75 })
  })

  it('summarises the sædskifte when no year is selected', () => {
    const levels = nNormLevelByFieldId(fields, years, null)
    expect(levels.get('a')).toEqual({
      kind: 'partial',
      pct: 75,
      responseYears: 1,
      years: 3,
    })
    expect(levels.get('b')).toEqual({ kind: 'noNorm' })
    expect(levels.get('c')).toEqual({ kind: 'level', pct: 75 })
  })

  it('uses the candidate ID for a mark whose years are not loaded', () => {
    const levels = nNormLevelByFieldId(fields, undefined, 0)
    expect(levels.get('b')).toEqual({ kind: 'level', pct: 85 })
    expect(levels.get('c')).toEqual({ kind: 'level', pct: 100 })
  })
})

describe('sorting', () => {
  it('sorts by the shown number, with no norm last', () => {
    expect(nNormLevelSortValue({ kind: 'noNorm' })).toBeNull()
    expect(nNormLevelSortValue({ kind: 'fullNorm' })).toBe(100)
    expect(nNormLevelSortValue({ kind: 'level', pct: 85 })).toBe(85)
    expect(
      nNormLevelSortValue({
        kind: 'partial',
        pct: 75,
        responseYears: 1,
        years: 3,
      }),
    ).toBe(75)
  })

  it('falls back to the candidate ID for a mark without a level', () => {
    const levels = new Map([['b', { kind: 'noNorm' } as const]])
    expect(fieldNNormSortValue(field('a', '1:1:80'), levels)).toBe(80)
    expect(fieldNNormSortValue(field('b', '1:1:80'), levels)).toBeNull()
    expect(fieldNNormSortValue(field('c', null), undefined)).toBeNull()
  })
})

describe('describeNNormLevel', () => {
  it('writes each kind in Danish', () => {
    expect(describeNNormLevel({ kind: 'level', pct: 75 })).toEqual({
      value: '75 %',
    })
    expect(describeNNormLevel({ kind: 'fullNorm' })).toMatchObject({
      value: '100 %',
      note: 'ingen udbyttekurve',
    })
    expect(describeNNormLevel({ kind: 'noNorm' })).toMatchObject({
      value: '-',
      muted: true,
    })
    expect(
      describeNNormLevel({
        kind: 'partial',
        pct: 75,
        responseYears: 3,
        years: 5,
      }),
    ).toMatchObject({ value: '75 %', note: '3 af 5 år' })
  })
})

describe('nNormLevelNote', () => {
  it('only speaks when the choice does not reach every year', () => {
    expect(nNormLevelNote(null)).toBeNull()
    expect(nNormLevelNote({ kind: 'level', pct: 75 })).toBeNull()
    expect(nNormLevelNote({ kind: 'fullNorm' })).toContain('udbyttekurve')
    expect(nNormLevelNote({ kind: 'noNorm' })).toContain('N-norm')
    expect(
      nNormLevelNote({
        kind: 'partial',
        pct: 75,
        responseYears: 3,
        years: 5,
      }),
    ).toBe('Valget gælder kun de 3 af 5 år med udbyttekurve.')
  })
})
