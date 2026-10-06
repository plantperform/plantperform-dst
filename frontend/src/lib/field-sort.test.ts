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

  it('sorts by tildelingsprocent with unoptimized marker last', () => {
    const full = { ...field('full', 1, 0), rotationId: '1:1:100' }
    const reduced = { ...field('reduced', 1, 0), rotationId: '1:1:80' }
    const none = { ...field('none', 1, 0), rotationId: null }
    const sorted = [none, full, reduced].sort((left, right) =>
      compareFields(left, right, { key: 'nNormPct', direction: 'asc' }),
    )
    expect(sorted.map(({ id }) => id)).toEqual(['reduced', 'full', 'none'])
  })
})
