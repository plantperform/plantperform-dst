import { describe, expect, it } from 'vitest'

import type { FieldRecord, RotationCandidateYearResult } from '@/api/types'
import {
  computeFieldTotals,
  emptyMeasures,
  fieldFigure,
  formatPerHa,
  formatSigned,
  summarizeCropDistribution,
  totalsFigure,
  totalsPerHa,
} from '@/lib/field-domain'

const field = (overrides: Partial<FieldRecord>): FieldRecord => ({
  id: 'field',
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
  name: 'field',
  areaHa: 1,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
  ...overrides,
})

const fields = [
  field({
    id: 'a',
    areaHa: 2,
    db2: 2000,
    nLoad: 10,
    leaching: 20,
    feedUnits: 100,
  }),
  field({
    id: 'b',
    areaHa: 3,
    db2: 3000,
    nLoad: 30,
    feedUnits: 0,
    quotaEligible: false,
  }),
  field({ id: 'c', areaHa: 5, db2: 999, nLoad: 999, rotationId: null }),
]

describe('computeFieldTotals', () => {
  it('keeps the area each total is summed over', () => {
    expect(computeFieldTotals(fields, true)).toMatchObject({
      areaHa: 10,
      calculatedAreaHa: 5,
      nLoadAreaHa: 2,
    })
  })
})

describe('totalsPerHa', () => {
  it('divides each total by the area it covers', () => {
    const totals = computeFieldTotals(fields, true)
    expect(totalsPerHa(totals, 'db2')).toBe(1000)
    expect(totalsPerHa(totals, 'feedUnits')).toBe(20)
    expect(totalsPerHa(totals, 'nLoad')).toBe(5)
    expect(totalsPerHa(totals, 'leaching')).toBe(10)
  })

  it('has no value without an area', () => {
    const totals = computeFieldTotals([field({ rotationId: null })], true)
    expect(totalsPerHa(totals, 'db2')).toBeNull()
    expect(totalsPerHa(totals, 'nLoad')).toBeNull()
  })
})

describe('fieldFigure', () => {
  it('shows the value per hectare with the total under it', () => {
    expect(fieldFigure(field({ areaHa: 5.38, db2: 9614.1 }), 'db2')).toEqual({
      value: '1.787 kr/ha',
      total: '9.614 kr i alt',
    })
    expect(fieldFigure(field({ areaHa: 5.38, nLoad: 3.82 }), 'nLoad')).toEqual({
      value: '0,7 kg N/ha',
      total: '3,8 kg N i alt',
    })
  })

  it('shows only the total without an area', () => {
    expect(fieldFigure(field({ areaHa: 0, db2: 120 }), 'db2')).toEqual({
      value: '120 kr',
    })
  })
})

describe('totalsFigure', () => {
  it('shows the farm per hectare with the total under it', () => {
    expect(totalsFigure(computeFieldTotals(fields, true), 'nLoad')).toEqual({
      value: '5 kg N/ha',
      total: '10 kg N i alt',
    })
  })
})

describe('formatPerHa', () => {
  it('writes kroner and feed units whole and kg N with one decimal', () => {
    expect(formatPerHa(1787.3, 'db2')).toBe('1.787 kr/ha')
    expect(formatPerHa(6123.4, 'feedUnits')).toBe('6.123 FE/ha')
    expect(formatPerHa(0.71, 'nLoad')).toBe('0,7 kg N/ha')
    expect(formatPerHa(3.64, 'leaching')).toBe('3,6 kg N/ha')
  })
})

describe('summarizeCropDistribution', () => {
  const yearResult = (
    leachingKgNHa: number,
    cropCode = 1,
    cropName = 'Vårbyg',
  ): RotationCandidateYearResult => ({
    year: { cropCode, cropName, undersownCropCode: null, undersownCropName: null },
    leachingKgNHa,
    leachingDetail: {},
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

  it('excludes a non-kvotegivende mark from the udledning shown per crop', () => {
    const quotaField = field({ id: 'a', areaHa: 2, retention: 0 })
    const excludedField = field({
      id: 'b',
      areaHa: 3,
      retention: 0,
      quotaEligible: false,
    })
    const yearsByFieldId = {
      a: [yearResult(10)],
      b: [yearResult(10)],
    }
    const result = summarizeCropDistribution(
      [quotaField, excludedField],
      yearsByFieldId,
      null,
      'crop',
    )
    expect(result).toHaveLength(1)
    // Both marks' area counts, but only the quota-eligible mark's leaching does -
    // without the exclusion this would be 50 (10 kg N/ha x 2 ha + 10 kg N/ha x 3 ha).
    expect(result[0].areaHa).toBe(5)
    expect(result[0].nLoadKgHa * result[0].areaHa).toBe(20)
  })
})

describe('formatSigned', () => {
  it('signs only a change that shows', () => {
    const kronerPerHa = (value: number) => formatPerHa(value, 'db2')
    expect(formatSigned(45.2, kronerPerHa)).toBe('+45 kr/ha')
    expect(formatSigned(-45.2, kronerPerHa)).toBe('−45 kr/ha')
    expect(formatSigned(0.3, kronerPerHa)).toBe('±0 kr/ha')
    expect(formatSigned(-0.3, kronerPerHa)).toBe('±0 kr/ha')
  })
})
