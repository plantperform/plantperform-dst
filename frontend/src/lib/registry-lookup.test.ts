import { describe, expect, it } from 'vitest'

import {
  describeLookup,
  describeLookupQuota,
  summarizeLookup,
  type LookupField,
} from '@/lib/registry-lookup'

const field = (
  catchmentId: number | null,
  catchmentName: string | null,
  areaHa: number,
  nLoadQuotaKgN: number,
  quotaEligible = true,
): LookupField => ({
  catchmentId,
  catchmentName,
  areaHa,
  nLoadQuotaKgN,
  quotaEligible,
})

const FOUND = [
  field(2, 'Skælskør Fjord og Nor', 20, 120),
  field(1, 'Basnæs Nor', 30.4, 200),
  field(1, 'Basnæs Nor', 5.5, 58),
  field(2, 'Skælskør Fjord og Nor', 8.2, 44, false),
  field(null, null, 3, 0),
]

const ONE_CATCHMENT = [field(1, 'Basnæs Nor', 79, 258)]

describe('summarizeLookup', () => {
  it('sums marker, areal and kvote per kystvandopland in name order', () => {
    const summary = summarizeLookup(FOUND)
    expect(summary.fieldCount).toBe(5)
    expect(summary.areaHa).toBeCloseTo(67.1)
    expect(
      summary.catchments.map((catchment) => [
        catchment.catchmentId,
        catchment.fieldCount,
      ]),
    ).toEqual([
      [1, 2],
      [2, 2],
      [null, 1],
    ])
    expect(summary.catchments[0].areaHa).toBeCloseTo(35.9)
    expect(summary.catchments[0].quotaKgN).toBe(258)
  })

  it('gives every opland its own colour for the map', () => {
    const colors = summarizeLookup(FOUND).catchments.map(
      (catchment) => catchment.color,
    )
    expect(new Set(colors).size).toBe(3)
  })

  it('counts a mark that is not kvotegivende in antal and areal but not in the kvote', () => {
    const summary = summarizeLookup(FOUND)
    const [, withExcludedField] = summary.catchments
    expect(withExcludedField.fieldCount).toBe(2)
    expect(withExcludedField.areaHa).toBeCloseTo(28.2)
    expect(withExcludedField.quotaKgN).toBe(120)
    expect(summary.quotaKgN).toBe(378)
  })

  it('leaves marker without a kystvandopland out of the number of oplande', () => {
    expect(summarizeLookup(FOUND).catchmentCount).toBe(2)
  })
})

describe('the texts for the marker found', () => {
  it('names the marker, the areal with one decimal and the oplande', () => {
    expect(describeLookup(summarizeLookup(FOUND))).toBe(
      'Vi fandt 5 marker på 67,1 ha i 2 kystvandoplande',
    )
  })

  it('writes a single opland as et kystvandopland', () => {
    expect(describeLookup(summarizeLookup(ONE_CATCHMENT))).toBe(
      'Vi fandt 1 mark på 79,0 ha i et kystvandopland',
    )
  })

  it('says how many lofter the samlede kvote is split on', () => {
    expect(describeLookupQuota(summarizeLookup(FOUND))).toBe(
      'Samlet kvote 378 kg N pr. år, fordelt på 2 lofter der hver skal holdes.',
    )
    expect(describeLookupQuota(summarizeLookup(ONE_CATCHMENT))).toBe(
      'Samlet kvote 258 kg N pr. år.',
    )
  })
})
