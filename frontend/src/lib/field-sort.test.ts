import { describe, expect, it } from 'vitest'

import type { FieldRecord } from '@/api/types'
import { emptyMeasures } from '@/lib/field-domain'
import { compareFields } from '@/lib/field-sort'

const field = (id: string, areaHa: number, db2: number): FieldRecord => ({
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
  db2,
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

describe('compareFields', () => {
  it('sorts the figures by their value per hectare', () => {
    const small = field('small', 1, 100)
    const large = field('large', 10, 500)
    const sorted = [large, small].sort((left, right) =>
      compareFields(left, right, { key: 'db2', direction: 'desc' }),
    )
    expect(sorted.map(({ id }) => id)).toEqual(['small', 'large'])
  })

  it('puts non-kvotegivende marker last when sorting by udledning', () => {
    const counted = { ...field('counted', 1, 0), nLoad: 5 }
    const excluded = {
      ...field('excluded', 1, 0),
      nLoad: 50,
      quotaEligible: false,
    }
    for (const direction of ['asc', 'desc'] as const) {
      const sorted = [excluded, counted].sort((left, right) =>
        compareFields(left, right, { key: 'nLoad', direction }),
      )
      expect(sorted.map(({ id }) => id)).toEqual(['counted', 'excluded'])
    }
  })

  it('sorts by N-norm level with unoptimized marker last', () => {
    const full = { ...field('full', 1, 0), rotationId: '1:1:100' }
    const reduced = { ...field('reduced', 1, 0), rotationId: '1:1:80' }
    const none = { ...field('none', 1, 0), rotationId: null }
    const sorted = [none, full, reduced].sort((left, right) =>
      compareFields(left, right, { key: 'nNormPct', direction: 'asc' }),
    )
    expect(sorted.map(({ id }) => id)).toEqual(['reduced', 'full', 'none'])
  })

  describe('by the crop of the selected year', () => {
    const withCrop = (
      id: string,
      cropCode: number,
      cropName: string,
    ): FieldRecord => ({
      ...field(id, 1, 0),
      cropRotation: [
        {
          cropCode: 1,
          cropName: 'Første',
          undersownCropCode: null,
          undersownCropName: null,
        },
        {
          cropCode,
          cropName,
          undersownCropCode: null,
          undersownCropName: null,
        },
      ],
    })
    const spring = withCrop('spring', 210, 'Vårbyg, helsæd')
    const wheat = withCrop('wheat', 11, 'Vinterhvede')
    const barley = withCrop('barley', 101, 'Vinterbyg')
    const none = field('none', 1, 0)

    const idsSortedBy = (
      key: 'cropCode' | 'cropYear',
      direction: 'asc' | 'desc',
      selectedYearIndex: number | null,
    ) =>
      [none, spring, wheat, barley]
        .sort((left, right) =>
          compareFields(
            left,
            right,
            { key, direction },
            undefined,
            selectedYearIndex,
          ),
        )
        .map(({ id }) => id)

    it('sorts by afgrødekode with marker without a crop last', () => {
      expect(idsSortedBy('cropCode', 'asc', 1)).toEqual([
        'wheat',
        'barley',
        'spring',
        'none',
      ])
      expect(idsSortedBy('cropCode', 'desc', 1)).toEqual([
        'spring',
        'barley',
        'wheat',
        'none',
      ])
    })

    it('sorts by crop name with marker without a crop last', () => {
      expect(idsSortedBy('cropYear', 'asc', 1)).toEqual([
        'barley',
        'wheat',
        'spring',
        'none',
      ])
      expect(idsSortedBy('cropYear', 'desc', 1)).toEqual([
        'spring',
        'wheat',
        'barley',
        'none',
      ])
    })

    it('falls back to the usual order until a year is selected', () => {
      const byId = ['barley', 'none', 'spring', 'wheat']
      expect(idsSortedBy('cropCode', 'asc', null)).toEqual(byId)
      expect(idsSortedBy('cropYear', 'desc', null)).toEqual(byId)
    })
  })
})
