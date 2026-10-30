import { describe, expect, it } from 'vitest'

import type { FieldRecord, RotationCandidateYearResult } from '@/api/types'
import { emptyMeasures } from '@/lib/field-domain'
import { summarizeWinterCover } from '@/lib/winter-cover-overview'

const field = (overrides: Partial<FieldRecord>): FieldRecord => ({
  id: 'field',
  farmId: 'farm',
  imkId: null,
  catchmentId: 7,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId: '315:4:80',
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 0,
  nLoad: 0,
  leaching: 0,
  feedUnits: 0,
  name: 'field',
  areaHa: 1,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
  ...overrides,
})

// The detail has the W class of the winter cover plus the measure flags.
const yearResult = (
  detail: Record<string, unknown>,
  undersownCropCode: number | null = null,
  leachingKgNHa = 10,
): RotationCandidateYearResult => ({
  year: {
    cropCode: 1,
    cropName: 'Vårbyg',
    undersownCropCode,
    undersownCropName: null,
  },
  leachingKgNHa,
  leachingDetail: detail,
  dbDkkHa: 0,
  dbDetail: {},
  precedingCropValueKgNHa: 0,
  appliedManureUtilisedKgNHa: 0,
  appliedMineralFertiliserKgNHa: 0,
  manureOrganicBoundKgNHa: 0,
  manureTonsPerHa: 0,
  cropNormKgNHa: null,
  nNormPct: 0,
})

const WINTER_CEREAL = { W: 1 }
const BARE_SOIL = { W: 2 }
const CATCH_CROP = { W: 4, EEA: 1 }
const STUBBLE = { W: 5 }
const INTERMEDIATE_CROP = { W: 4, EMA: 1 }
const EARLY_SOWING = { W: 1, ETS: 1 }

describe('summarizeWinterCover', () => {
  it('gives every kind of cover its own slice, the measures first', () => {
    const shares = summarizeWinterCover(
      [field({ id: 'a', areaHa: 8 })],
      {
        a: [
          yearResult(CATCH_CROP),
          yearResult(INTERMEDIATE_CROP),
          yearResult(EARLY_SOWING),
          yearResult(WINTER_CEREAL),
          yearResult(BARE_SOIL),
          yearResult(BARE_SOIL),
          yearResult(BARE_SOIL),
          yearResult(BARE_SOIL),
        ],
      },
      null,
    )

    expect(shares.map(({ id, areaHa }) => [id, areaHa])).toEqual([
      ['catchCrop', 1],
      ['intermediateCrop', 1],
      ['earlySowing', 1],
      ['winterCereal', 1],
      ['bareSoil', 4],
    ])
    expect(shares.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1)
  })

  it('tells vintersæd, græs, raps og roer and undersået græs og brak apart', () => {
    const shares = summarizeWinterCover(
      [field({ id: 'a', areaHa: 6 })],
      {
        a: [
          yearResult({ W: 1 }),
          // Vintersæd after grass.
          yearResult({ W: 7 }),
          yearResult({ W: 6 }),
          // Grass or clover grass that is ploughed late.
          yearResult({ W: 8 }),
          // Undersown grass or fallow, without a catch crop sown.
          yearResult({ W: 4 }),
          // An undersown grass reported as udlæg has no W at all.
          yearResult({}, 960),
        ],
      },
      null,
    )

    expect(shares.map(({ id, areaHa }) => [id, areaHa])).toEqual([
      ['winterCereal', 2],
      ['grassRapeBeets', 2],
      ['undersownOrFallow', 2],
    ])
  })

  it('leaves a cover from an unknown W class out of the shares', () => {
    expect(
      summarizeWinterCover(
        [field({ id: 'a' })],
        { a: [yearResult({ W: 99 })] },
        null,
      ),
    ).toEqual([])
  })

  it('counts stub only for the years without a catch crop or mellemafgrøde', () => {
    const shares = summarizeWinterCover(
      [field({ id: 'a', areaHa: 4 })],
      {
        a: [
          yearResult(STUBBLE),
          // The same stubble class, but with a catch crop sown.
          yearResult({ W: 5, EEA: 1 }),
          yearResult({ W: 5, EMA: 1 }),
          yearResult(BARE_SOIL),
        ],
      },
      null,
    )

    expect(shares.map(({ id, areaHa }) => [id, areaHa])).toEqual([
      ['catchCrop', 1],
      ['intermediateCrop', 1],
      ['stubble', 1],
      ['bareSoil', 1],
    ])
  })

  it('counts a year with tidlig såning and another cover as tidlig såning', () => {
    const [share] = summarizeWinterCover(
      [field({ id: 'a' })],
      { a: [yearResult(EARLY_SOWING)] },
      null,
    )

    expect(share.id).toBe('earlySowing')
  })

  it('counts a year with both a catch crop and tidlig såning as the catch crop', () => {
    const [share] = summarizeWinterCover(
      [field({ id: 'a' })],
      { a: [yearResult({ W: 4, EEA: 1, ETS: 1 })] },
      null,
    )

    expect(share.id).toBe('catchCrop')
  })

  it('weights each year by its share of the mark, over all years', () => {
    const shares = summarizeWinterCover(
      [field({ id: 'a', areaHa: 4 }), field({ id: 'b', areaHa: 2 })],
      {
        a: [yearResult(CATCH_CROP), yearResult(BARE_SOIL)],
        b: [yearResult(CATCH_CROP)],
      },
      null,
    )

    expect(shares.map(({ id, areaHa }) => [id, areaHa])).toEqual([
      ['catchCrop', 4],
      ['bareSoil', 2],
    ])
  })

  it('shows only the selected year', () => {
    const shares = summarizeWinterCover(
      [field({ id: 'a', areaHa: 4 })],
      { a: [yearResult(CATCH_CROP), yearResult(BARE_SOIL)] },
      1,
    )

    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({ id: 'bareSoil', areaHa: 4, share: 1 })
  })

  it('leaves years without a known cover out of the shares', () => {
    const shares = summarizeWinterCover(
      [field({ id: 'a', areaHa: 4 })],
      {
        a: [
          yearResult(CATCH_CROP),
          yearResult({ runoffCategoryUnknown: true, W: 1 }),
        ],
      },
      null,
    )

    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({ id: 'catchCrop', areaHa: 2, share: 1 })
  })

  it('reads the cover from a reported catch crop when the year has no detail', () => {
    const [share] = summarizeWinterCover(
      [field({ id: 'a' })],
      { a: [yearResult({}, 968)] },
      null,
    )

    expect(share.id).toBe('catchCrop')
  })

  it('ignores years without values and marks without years', () => {
    const shares = summarizeWinterCover(
      [field({ id: 'a' }), field({ id: 'b' })],
      { a: [yearResult(CATCH_CROP, null, 0)] },
      null,
    )

    expect(shares).toEqual([])
  })

  it('returns nothing without year values', () => {
    expect(summarizeWinterCover([field({ id: 'a' })], undefined, null)).toEqual(
      [],
    )
  })
})
