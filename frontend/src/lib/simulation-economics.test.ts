import { describe, expect, it } from 'vitest'

import type { RotationYear } from '@/api/types'
import {
  NO_OVERRIDES,
  withPriceOverride,
  type CropEconomics,
  type EconomicsAssumptions,
} from '@/lib/economics'
import { simulationEconomicsEffect } from '@/lib/simulation-economics'

const crop = (
  cropCode: number,
  cropName: string,
  yieldHkgHa: number,
  ploughed: boolean,
): CropEconomics => ({
  cropCode,
  cropName,
  precedingCropValueKgNHa: 0,
  revenue: [
    {
      id: 'grain',
      label: 'Kerne',
      quantity: yieldHkgHa,
      quantityUnit: 'hkg/ha',
      priceId: `sale:${cropCode}`,
    },
  ],
  subsidies: [],
  costs: {
    fertiliser: [],
    seed: [],
    cropProtection: [],
    fieldWork: ploughed
      ? [
          {
            id: 'ploughing',
            label: 'Pløjning',
            quantity: 1,
            quantityUnit: 'gange',
            priceId: 'rate:Pløjning',
          },
        ]
      : [],
    drying: [],
  },
})

const price = (id: string, label: string, unit: string, valueDkk: number) => ({
  id,
  label,
  unit,
  valueDkk,
  source: 'SEGES',
})

const ASSUMPTIONS: EconomicsAssumptions = {
  prices: [
    price('sale:1', 'Salgspris', 'kr/hkg', 100),
    price('sale:11', 'Salgspris', 'kr/hkg', 120),
    price('sale:22', 'Salgspris', 'kr/hkg', 300),
    price('rate:Pløjning', 'Pløjning', 'kr/gang', 800),
  ],
  crops: [
    crop(1, 'Vårbyg', 60, true),
    crop(11, 'Vinterhvede', 80, true),
    crop(22, 'Vinterraps', 40, false),
  ],
}

const year = (cropCode: number, cropName: string): RotationYear => ({
  cropCode,
  cropName,
  undersownCropCode: null,
  undersownCropName: null,
})

const SPRING_BARLEY = year(1, 'Vårbyg')
const WINTER_WHEAT = year(11, 'Vinterhvede')
const MAIZE = year(216, 'Silomajs')

const FIELDS = [
  { areaHa: 10, cropRotation: [SPRING_BARLEY, WINTER_WHEAT] },
  { areaHa: 6, cropRotation: [WINTER_WHEAT, WINTER_WHEAT, MAIZE] },
  { areaHa: 3, cropRotation: [] },
]

describe('simulationEconomicsEffect', () => {
  it('spreads each field over the years of its rotation', () => {
    const effect = simulationEconomicsEffect(ASSUMPTIONS, NO_OVERRIDES, FIELDS)
    expect(
      effect.crops.map(({ cropName, areaHa }) => ({ cropName, areaHa })),
    ).toEqual([
      { cropName: 'Vinterhvede', areaHa: 9 },
      { cropName: 'Vårbyg', areaHa: 5 },
    ])
    expect(effect.otherCrops).toEqual([
      { cropCode: 216, cropName: 'Silomajs', areaHa: 2 },
    ])
    expect(effect.deltaDkk).toBe(0)
  })

  it('multiplies the change per ha by the area of the crop', () => {
    const overrides = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'sale:1',
      110,
    )
    const effect = simulationEconomicsEffect(ASSUMPTIONS, overrides, FIELDS)
    const [winterWheat, springBarley] = effect.crops
    expect(springBarley.deltaDkkHa).toBe(600)
    expect(springBarley.deltaDkk).toBe(3000)
    expect(springBarley.changes.map((change) => change.label)).toEqual([
      'Salgspris',
    ])
    expect(winterWheat.deltaDkk).toBe(0)
    expect(winterWheat.changes).toEqual([])
    expect(effect.deltaDkk).toBe(3000)
  })

  it('counts a shared price for every crop that uses it', () => {
    const overrides = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'rate:Pløjning',
      700,
    )
    const effect = simulationEconomicsEffect(ASSUMPTIONS, overrides, FIELDS)
    expect(effect.crops.map((entry) => entry.deltaDkk)).toEqual([900, 500])
    expect(effect.crops.map((entry) => entry.changes.length)).toEqual([1, 1])
    expect(effect.deltaDkk).toBe(1400)
  })

  it('names the changed crops the simulation does not grow', () => {
    const overrides = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'sale:22',
      330,
    )
    const effect = simulationEconomicsEffect(ASSUMPTIONS, overrides, FIELDS)
    expect(effect.unusedCropNames).toEqual(['Vinterraps'])
    expect(effect.deltaDkk).toBe(0)
  })

  it('adds up the whole kroner shown for each crop', () => {
    const overrides = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'rate:Pløjning',
      770,
    )
    const effect = simulationEconomicsEffect(ASSUMPTIONS, overrides, [
      { areaHa: 3.25, cropRotation: [SPRING_BARLEY] },
      { areaHa: 1.25, cropRotation: [WINTER_WHEAT] },
    ])
    expect(effect.crops.map((entry) => entry.deltaDkk)).toEqual([98, 38])
    expect(effect.deltaDkk).toBe(136)
  })
})
