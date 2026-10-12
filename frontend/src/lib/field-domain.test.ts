import { describe, expect, it } from 'vitest'

import type { FieldRecord, FieldYearValue, RotationCandidateYearResult } from '@/api/types'
import { fromWire } from '@/api/wire'
import { fieldFertiliser } from '@/lib/fertiliser-overview'
import {
  computeFieldTotals,
  emptyMeasures,
  fieldFigure,
  fieldNNormPct,
  nNormTargetKgNHa,
  yieldResponse,
  formatPerHa,
  formatSigned,
  summarizeCropDistribution,
  totalsFigure,
  totalsPerHa,
  applyFieldYearValues,
  summarizeFieldYears,
  yearFeedUnitsPerHa,
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

describe('stored compact field years', () => {
  it('uses stored FEN and fertilizer inputs without calculation reports', () => {
    const year = fromWire<FieldYearValue>({
      year: { afgrodeKode: 252, afgrodeNavn: 'Græs' },
      leachingKgNHa: 20, dbKrHa: 1000, fenFeHa: 125,
      forfrugtsvaerdiKgnHa: 10, tildeltHusdyrgodningUdnyttetKgnHa: 30,
      tildeltHandelsgodningKgnHa: 60, husdyrgodningOrganiskBundetKgnHa: 15,
      husdyrgodningTonPrHa: 5, afgrodeNormKgnHa: 100, nNormPct: 100,
      winterCover: { W: 1, EEA: 1 },
    })
    expect(yearFeedUnitsPerHa(year)).toBe(125)
    expect(year).not.toHaveProperty('dbDetail')
    expect(year.winterCover).toEqual({ W: 1, EEA: 1 })
    const selected = field({ areaHa: 2, retention: 50 })
    expect(applyFieldYearValues([selected], { field: [year] }, 0)[0])
      .toMatchObject({ db2: 2000, nLoad: 20, leaching: 40, feedUnits: 250 })
    expect(summarizeFieldYears([selected], { field: [year] }, false)[0])
      .toMatchObject({ totalDb2: 2000, totalNLoadKg: 20, totalFeedUnits: 250 })
    expect(fieldFertiliser([year], 0)).toEqual({
      cropNormKgNHa: 100, precedingCropValueKgNHa: 10, mineralFertiliserKgNHa: 60,
      manureUtilisedKgNHa: 30, manureOrganicBoundKgNHa: 15, manureTonsPerHa: 5,
    })
  })
})

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
    year: {
      cropCode,
      cropName,
      undersownCropCode: null,
      undersownCropName: null,
    },
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
    // Both marks count towards the crop's area, but only the quota-eligible
    // mark counts towards its udledning, in total and per hectare.
    expect(result[0].areaHa).toBe(5)
    expect(result[0].nLoadKg).toBe(20)
    expect(result[0].nLoadKgHa).toBe(10)
  })

  it('has no udledning per hectare for a crop only on non-kvotegivende marker', () => {
    const excludedField = field({
      id: 'b',
      areaHa: 3,
      retention: 0,
      quotaEligible: false,
    })
    const [share] = summarizeCropDistribution(
      [excludedField],
      { b: [yearResult(10)] },
      null,
      'crop',
    )
    expect(share.nLoadKg).toBe(0)
    expect(share.nLoadKgHa).toBeNull()
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

describe('yield response in the walkthrough', () => {
  it('derives the normudbytte from the reduced yield', () => {
    const response = yieldResponse(85.5, 0.95)
    expect(response?.factor).toBe(0.95)
    expect(response?.normYield).toBeCloseTo(90)
  })

  it('has no response at full yield or without a factor', () => {
    expect(yieldResponse(90, 1)).toBeNull()
    expect(yieldResponse(90, undefined)).toBeNull()
  })

  it('caps the N at the N-norm level', () => {
    expect(nNormTargetKgNHa(206, 80)).toBeCloseTo(164.8)
  })
})

describe('N-norm level per mark', () => {
  it('reads the level from the candidate ID', () => {
    expect(fieldNNormPct(field({ rotationId: '315:4:80' }))).toBe(80)
    expect(fieldNNormPct(field({ rotationId: null }))).toBeNull()
  })
})
