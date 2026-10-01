import { describe, expect, it } from 'vitest'

import type { CropAreaRange, FieldRecord, RotationYear } from '@/api/types'
import {
  cropAreaLimitError,
  cropAreaLimitFromDraft,
  cropAreaLimitParts,
  cropAreaLimitWarning,
  cropAreaRangeError,
  cropAreaRangeWarnings,
  cropAreaViolationsFromDetail,
  currentCropAreaHa,
  currentCropAreaLabel,
  emptyCropAreaLimitInput,
  fieldAreaSums,
  hectareDraft,
  inputFromCropAreaLimit,
  isEmptyCropAreaLimit,
  possibleCropArea,
  sameCropAreaLimits,
  totalFieldAreaHa,
  type CropAreaLimitDraft,
  type CropAreaLimitInput,
} from '@/lib/crop-area-limits'

const POTATOES = 150

const draft = (values: Partial<CropAreaLimitDraft>): CropAreaLimitDraft => ({
  cropCode: POTATOES,
  minHa: '',
  maxHa: '',
  ...values,
})

const input = (values: Partial<CropAreaLimitInput>): CropAreaLimitInput => ({
  ...emptyCropAreaLimitInput(POTATOES),
  ...values,
})

describe('totalFieldAreaHa', () => {
  it('adds up the area of the fields', () => {
    const fields = [{ areaHa: 50 }, { areaHa: 30 }] as FieldRecord[]
    expect(totalFieldAreaHa(fields)).toBe(80)
  })
})

describe('hectares and percent', () => {
  it('reads a saved limit in hectares', () => {
    expect(
      inputFromCropAreaLimit({
        cropCode: POTATOES,
        minAreaHa: 20,
        maxAreaHa: null,
      }),
    ).toEqual({ cropCode: POTATOES, min: '20', max: '', unit: 'ha' })
  })

  it('keeps hectares as they are typed', () => {
    expect(hectareDraft(input({ min: '20' }), 80)).toEqual(
      draft({ minHa: '20' }),
    )
  })

  it('turns percent into hectares of the total area', () => {
    expect(
      hectareDraft(input({ min: '25', max: '50', unit: '%' }), 80),
    ).toEqual(draft({ minHa: '20', maxHa: '40' }))
  })

  it('leaves an empty or unreadable percent for the error', () => {
    expect(hectareDraft(input({ min: 'x', unit: '%' }), 80)).toEqual(
      draft({ minHa: 'x' }),
    )
  })

  it('saves the limit in hectares', () => {
    expect(
      cropAreaLimitFromDraft(hectareDraft(input({ min: '25', unit: '%' }), 80)),
    ).toEqual({ cropCode: POTATOES, minAreaHa: 20, maxAreaHa: null })
  })
})

describe('cropAreaLimitParts', () => {
  it('describes the range in the unit it was typed in', () => {
    expect(cropAreaLimitParts(input({ min: '15', max: '25' }))).toEqual({
      prefix: null,
      amount: '15–25',
      unit: 'ha',
    })
    expect(
      cropAreaLimitParts(input({ min: '12', max: '14', unit: '%' })),
    ).toEqual({ prefix: null, amount: '12–14', unit: '%' })
    expect(cropAreaLimitParts(input({ min: '15.5' }))).toEqual({
      prefix: 'mindst',
      amount: '15,5',
      unit: 'ha',
    })
    expect(cropAreaLimitParts(input({ max: '25' }))).toEqual({
      prefix: 'højst',
      amount: '25',
      unit: 'ha',
    })
    expect(cropAreaLimitParts(input({}))).toBeNull()
  })
})

describe('isEmptyCropAreaLimit', () => {
  it('sees an added crop without numbers as empty', () => {
    expect(isEmptyCropAreaLimit(draft({}))).toBe(true)
    expect(isEmptyCropAreaLimit(draft({ minHa: ' ' }))).toBe(true)
  })

  it('sees one typed bound as started', () => {
    expect(isEmptyCropAreaLimit(draft({ maxHa: '12' }))).toBe(false)
    expect(isEmptyCropAreaLimit(draft({ minHa: 'x' }))).toBe(false)
  })
})

describe('cropAreaLimitError', () => {
  it('accepts min alone, max alone, and min equal to max', () => {
    expect(cropAreaLimitError(draft({ minHa: '20' }))).toBeNull()
    expect(cropAreaLimitError(draft({ maxHa: '20' }))).toBeNull()
    expect(cropAreaLimitError(draft({ minHa: '20', maxHa: '20' }))).toBeNull()
  })

  it('rejects a minimum above the maximum', () => {
    expect(cropAreaLimitError(draft({ minHa: '30', maxHa: '20' }))).toBe(
      'Min. er større end maks.',
    )
  })

  it('compares the bounds as numbers, not text', () => {
    expect(cropAreaLimitError(draft({ minHa: '9', maxHa: '10' }))).toBeNull()
  })

  it('needs at least one bound', () => {
    expect(cropAreaLimitError(draft({}))).toBe(
      'Angiv et minimum eller et maksimum.',
    )
  })

  it('rejects negative areas', () => {
    expect(cropAreaLimitError(draft({ minHa: '-1' }))).toBe(
      'Arealet kan ikke være negativt.',
    )
  })
})

describe('sameCropAreaLimits', () => {
  const limit = { cropCode: POTATOES, minAreaHa: 20, maxAreaHa: null }

  it('sees equal limits as unchanged', () => {
    expect(sameCropAreaLimits([limit], [{ ...limit }])).toBe(true)
  })

  it('sees a changed bound or a removed limit as a change', () => {
    expect(sameCropAreaLimits([limit], [{ ...limit, maxAreaHa: 30 }])).toBe(
      false,
    )
    expect(sameCropAreaLimits([], [limit])).toBe(false)
  })
})

describe('cropAreaViolationsFromDetail', () => {
  it('reads the crop codes and years of an infeasible run', () => {
    expect(
      cropAreaViolationsFromDetail({
        message: 'Kravene kan ikke opfyldes',
        cropAreaViolations: [
          { cropCode: POTATOES, years: [2027, 2029] },
          { cropCode: 1, years: [] },
        ],
      }),
    ).toEqual([
      { cropCode: POTATOES, years: [2027, 2029] },
      { cropCode: 1, years: [] },
    ])
  })

  it('finds none in a plain error message', () => {
    expect(cropAreaViolationsFromDetail('Simulering ikke fundet')).toEqual([])
    expect(cropAreaViolationsFromDetail(undefined)).toEqual([])
  })
})

const year = (cropCode: number): RotationYear => ({
  cropCode,
  cropName: String(cropCode),
  undersownCropCode: null,
  undersownCropName: null,
})

const field = (areaHa: number, codes: number[] = []) =>
  ({ areaHa, cropRotation: codes.map(year) }) as FieldRecord

describe('currentCropAreaHa', () => {
  it('averages each rotation repeated through the eight planning years', () => {
    const fields = [
      field(10, [POTATOES, 1]),
      field(20, [2, POTATOES, 2]),
      field(5),
    ]
    expect(currentCropAreaHa(fields, POTATOES)).toBe(12.5)
  })

  it('describes the average area', () => {
    expect(currentCropAreaLabel(12.5)).toBe('Nuværende 12,5 ha')
    expect(currentCropAreaLabel(0)).toBe('Nuværende 0 ha')
  })
})

describe('cropAreaLimitWarning', () => {
  const fields = [field(12), field(17), field(25)]
  const sums = fieldAreaSums(fields)

  it('warns when no whole fields add up to the range', () => {
    expect(
      cropAreaLimitWarning(draft({ minHa: '20', maxHa: '22' }), 54, sums),
    ).toBe('Spændet kan ikke nås, fordi marker ikke deles. Gør det bredere.')
  })

  it('accepts a range that whole fields can hit', () => {
    expect(
      cropAreaLimitWarning(draft({ minHa: '28', maxHa: '30' }), 54, sums),
    ).toBeNull()
    expect(
      cropAreaLimitWarning(draft({ minHa: '12', maxHa: '12' }), 54, sums),
    ).toBeNull()
  })

  it('warns when the minimum is above the total area', () => {
    expect(cropAreaLimitWarning(draft({ minHa: '60' }), 54, sums)).toBe(
      'Minimum er større end simuleringens samlede areal på 54 ha.',
    )
  })

  it('leaves invalid rows to the error', () => {
    expect(
      cropAreaLimitWarning(draft({ minHa: '30', maxHa: '20' }), 54, sums),
    ).toBeNull()
  })
})

describe('possible crop area', () => {
  const beans: CropAreaRange = {
    cropCode: POTATOES,
    minAverageHa: 0.5,
    maxAverageHa: 7.54,
    minHaByYear: [0, 4, 0, 0, 0, 0, 0, 0],
    maxHaByYear: [30, 30, 30, 30, 30, 30, 30, 30],
    yearlyMaxAverageHa: 7.54,
  }

  it('takes the widest of the two optimizations', () => {
    expect(possibleCropArea(beans)).toEqual({
      lowestMaxHa: 0.5,
      highestMinHa: 7.54,
    })
  })

  it('blocks a minimum neither optimization can reach', () => {
    expect(cropAreaRangeError(draft({ minHa: '10' }), beans)).toBe(
      'Højst 7,5 ha er muligt med simuleringens sædskifter og låste marker.',
    )
    expect(cropAreaRangeWarnings(draft({ minHa: '10' }), beans)).toEqual([])
  })

  it('blocks a maximum below what is fixed', () => {
    expect(cropAreaRangeError(draft({ maxHa: '0.2' }), beans)).toBe(
      'Mindst 0,5 ha ligger fast med simuleringens sædskifter og låste marker.',
    )
  })

  it('warns when only one optimization can meet the limit', () => {
    expect(cropAreaRangeError(draft({ maxHa: '2' }), beans)).toBeNull()
    expect(cropAreaRangeWarnings(draft({ maxHa: '2' }), beans)).toEqual([
      'Kun Gennemsnit for perioden kan overholde maksimum - Loft hvert år har mindst 4 ha i 2028.',
    ])
    const weakYears = { ...beans, maxHaByYear: [0, 30, 30, 30, 30, 30, 30, 0] }
    expect(cropAreaRangeWarnings(draft({ minHa: '5' }), weakYears)).toEqual([
      'Kun Gennemsnit for perioden kan opfylde minimum - Loft hvert år kan højst nå 0 ha i 2027, 2034.',
    ])
  })

  it('accepts a limit both can meet, and checks nothing without a range', () => {
    const limit = draft({ minHa: '1', maxHa: '20' })
    expect(cropAreaRangeError(limit, beans)).toBeNull()
    expect(cropAreaRangeWarnings(limit, beans)).toEqual([])
    expect(cropAreaRangeError(draft({ minHa: '10' }), undefined)).toBeNull()
  })
})
