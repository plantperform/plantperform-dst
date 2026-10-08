import { describe, expect, it } from 'vitest'

import type { FieldRecord, RotationCandidateYearResult } from '@/api/types'
import {
  availableNKgNHa,
  availableNShareOfNorm,
  fertiliserByFieldId,
  fieldFertiliser,
  totalFertiliser,
} from '@/lib/fertiliser-overview'
import { emptyMeasures } from '@/lib/field-domain'

const yearResult = (
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
  dbDetail: {},
  precedingCropValueKgNHa: 0,
  appliedManureUtilisedKgNHa: 0,
  appliedMineralFertiliserKgNHa: 0,
  manureOrganicBoundKgNHa: 0,
  manureTonsPerHa: 0,
  cropNormKgNHa: 100,
  nNormPct: 100,
  ...overrides,
})

const field = (id: string, areaHa: number): FieldRecord => ({
  id,
  farmId: 'farm',
  imkId: null,
  catchmentId: 7,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId: 'r1',
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 0,
  nLoad: 0,
  leaching: 0,
  feedUnits: 0,
  name: id,
  areaHa,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
})

describe('fieldFertiliser', () => {
  const years = [
    yearResult({
      cropNormKgNHa: 150,
      precedingCropValueKgNHa: 0,
      appliedMineralFertiliserKgNHa: 100,
      appliedManureUtilisedKgNHa: 50,
      manureOrganicBoundKgNHa: 30,
      manureTonsPerHa: 20,
    }),
    yearResult({
      cropNormKgNHa: 50,
      precedingCropValueKgNHa: 20,
      appliedMineralFertiliserKgNHa: 30,
      appliedManureUtilisedKgNHa: 0,
      manureOrganicBoundKgNHa: 0,
      manureTonsPerHa: 0,
    }),
  ]

  it('takes the selected year as it is', () => {
    expect(fieldFertiliser(years, 1)).toEqual({
      cropNormKgNHa: 50,
      precedingCropValueKgNHa: 20,
      mineralFertiliserKgNHa: 30,
      manureUtilisedKgNHa: 0,
      manureOrganicBoundKgNHa: 0,
      manureTonsPerHa: 0,
    })
  })

  it('averages the sædskifte per year without a selected year', () => {
    expect(fieldFertiliser(years, null)).toEqual({
      cropNormKgNHa: 100,
      precedingCropValueKgNHa: 10,
      mineralFertiliserKgNHa: 65,
      manureUtilisedKgNHa: 25,
      manureOrganicBoundKgNHa: 15,
      manureTonsPerHa: 10,
    })
  })

  it('leaves out years without values from the average', () => {
    const withEmptyYear = [
      ...years,
      yearResult({ leachingKgNHa: 0, dbDkkHa: 0, cropNormKgNHa: 0 }),
    ]
    expect(fieldFertiliser(withEmptyYear, null)?.cropNormKgNHa).toBe(100)
    expect(fieldFertiliser(withEmptyYear, 2)).toBeNull()
  })

  it('has no average norm when a counted year has no norm', () => {
    const missingNorm = [years[0], yearResult({ cropNormKgNHa: null })]
    const figures = fieldFertiliser(missingNorm, null)
    expect(figures?.cropNormKgNHa).toBeNull()
    expect(figures?.mineralFertiliserKgNHa).toBe(50)
  })

  it('has no figures for a mark without year values', () => {
    expect(fieldFertiliser(undefined, null)).toBeNull()
  })
})

describe('available N', () => {
  const figures = fieldFertiliser(
    [
      yearResult({
        cropNormKgNHa: 109,
        precedingCropValueKgNHa: 21,
        appliedMineralFertiliserKgNHa: 88,
        appliedManureUtilisedKgNHa: 0,
        manureOrganicBoundKgNHa: 40,
      }),
    ],
    0,
  )!

  it('counts forfrugt and tildelt N but not the organically bound N', () => {
    expect(availableNKgNHa(figures)).toBe(109)
    expect(availableNShareOfNorm(figures)).toBe(1)
  })

  it('has no share of a missing or zero norm', () => {
    expect(availableNShareOfNorm({ ...figures, cropNormKgNHa: null })).toBe(
      null,
    )
    expect(availableNShareOfNorm({ ...figures, cropNormKgNHa: 0 })).toBe(null)
  })
})

describe('farm totals', () => {
  const fields = [field('a', 2), field('b', 3), field('c', 5)]
  const byFieldId = fertiliserByFieldId(
    fields,
    {
      a: [
        yearResult({
          cropNormKgNHa: 100,
          appliedMineralFertiliserKgNHa: 100,
        }),
      ],
      b: [
        yearResult({
          cropNormKgNHa: null,
          appliedMineralFertiliserKgNHa: 50,
        }),
      ],
    },
    null,
  )

  it('weights by area over the marker with the figure', () => {
    expect(totalFertiliser(fields, byFieldId, (f) => f.cropNormKgNHa)).toEqual(
      { amount: 200, areaHa: 2 },
    )
    expect(
      totalFertiliser(fields, byFieldId, (f) => f.mineralFertiliserKgNHa),
    ).toEqual({ amount: 350, areaHa: 5 })
  })

  it('has no total without figures', () => {
    expect(
      totalFertiliser(fields, new Map(), (f) => f.manureTonsPerHa),
    ).toBeNull()
  })
})
