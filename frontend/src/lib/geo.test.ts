import { describe, expect, it } from 'vitest'

import type { FieldRecord, GeoJSONPolygon } from '@/api/types'
import {
  fieldLabelPoint,
  fieldsToFeatureCollection,
  type FieldYearProperties,
} from '@/lib/geo'

const square = (lng: number): GeoJSONPolygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, 55],
      [lng + 0.01, 55],
      [lng + 0.01, 55.01],
      [lng, 55.01],
      [lng, 55],
    ],
  ],
})

describe('fieldLabelPoint', () => {
  it('works out the point once for each geometry', () => {
    const field = { geometry: square(9) }
    const point = fieldLabelPoint(field)
    expect(point).not.toBeNull()
    expect(fieldLabelPoint({ ...field })).toBe(point)
    expect(fieldLabelPoint({ geometry: square(10) })).not.toEqual(point)
  })
})

const field = (overrides: Partial<FieldRecord> = {}): FieldRecord => ({
  id: 'a',
  farmId: 'farm',
  imkId: 1,
  name: 'Mark',
  catchmentId: null,
  retention: 50,
  soilTypeNumber: 4,
  cropRotation: [],
  rotationId: null,
  measures: {
    precisionFarming: false,
    coverCropYears: [],
    earlySowingYears: [],
  },
  allowedRotationIds: [],
  db2: 0,
  nLoad: 30,
  leaching: 60,
  feedUnits: 0,
  areaHa: 2,
  inTakeoutPlan: 'nej',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: square(9),
  ...overrides,
})

const year = (
  leaching: Record<string, number>,
  nLoad: Record<string, number>,
): FieldYearProperties => ({
  yearIndex: 3,
  leachingKgHaByFieldId: leaching,
  nLoadKgHaByFieldId: nLoad,
})

const properties = (record: FieldRecord, yearProperties?: FieldYearProperties) =>
  fieldsToFeatureCollection([record], false, undefined, yearProperties)
    .features[0].properties

describe('fieldsToFeatureCollection', () => {
  it('colours Udvaskning and Udledning by the average per ha without a year', () => {
    expect(properties(field())).toMatchObject({ leaching: 30, nLoad: 15 })
  })

  it('colours Udvaskning and Udledning by the selected year', () => {
    expect(
      properties(field(), year({ a: 44 }, { a: 22 })),
    ).toMatchObject({ leaching: 44, nLoad: 22 })
  })

  it('gives a field without values for the selected year no value', () => {
    expect(properties(field(), year({}, {}))).toMatchObject({
      leaching: null,
      nLoad: null,
    })
  })

  it('gives a field outside the quota calculation no value', () => {
    expect(
      properties(field({ quotaEligible: false }), year({ a: 44 }, { a: 22 })),
    ).toMatchObject({ leaching: null, nLoad: null })
  })
})
