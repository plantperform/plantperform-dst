import { describe, expect, it } from 'vitest'

import {
  cropTotals,
  formatEconomicsNumber,
  isCropCustomised,
  isPriceCustomised,
  isQuantityCustomised,
  NO_OVERRIDES,
  parseEconomicsInput,
  priceUsage,
  quantityUnitLabel,
  withPriceOverride,
  withQuantityOverride,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsLine,
} from '@/lib/economics'
import { EXAMPLE_ECONOMICS } from '@/lib/economics-example'

const line = (
  id: string,
  quantity: number,
  quantityUnit: string,
  priceId: string,
): EconomicsLine => ({ id, label: id, quantity, quantityUnit, priceId })

const crop = (
  cropCode: number,
  cropName: string,
  parts: Partial<Pick<CropEconomics, 'revenue' | 'subsidies'>> & {
    fieldWork?: EconomicsLine[]
  },
): CropEconomics => ({
  cropCode,
  cropName,
  precedingCropValueKgNHa: 0,
  revenue: parts.revenue ?? [],
  subsidies: parts.subsidies ?? [],
  costs: {
    seed: [],
    cropProtection: [],
    fieldWork: parts.fieldWork ?? [],
    drying: [],
  },
})

const RAPESEED = crop(22, 'Vinterraps', {
  revenue: [line('grain', 44, 'hkg/ha', 'rapeseedPrice')],
  subsidies: [line('basicPayment', 1, 'ha', 'basicPayment')],
  fieldWork: [
    line('ploughing', 1, 'gange', 'ploughing'),
    line('spraying', 7, 'gange', 'spraying'),
  ],
})

const PEAS = crop(30, 'Ærter', {
  fieldWork: [
    line('ploughing', 1, 'gange', 'ploughing'),
    line('spraying', 2, 'gange', 'spraying'),
  ],
})

const ASSUMPTIONS: EconomicsAssumptions = {
  prices: [
    {
      id: 'rapeseedPrice',
      label: 'Salgspris',
      unit: 'kr/hkg',
      valueDkk: 335,
      source: 'SEGES',
    },
    {
      id: 'basicPayment',
      label: 'Grundbetaling',
      unit: 'kr/ha',
      valueDkk: 1575,
      source: 'Prisliste',
    },
    {
      id: 'ploughing',
      label: 'Pløjning med pakning',
      unit: 'kr/gang',
      valueDkk: 825,
      source: 'SEGES',
    },
    {
      id: 'spraying',
      label: 'Sprøjtning',
      unit: 'kr/gang',
      valueDkk: 160,
      source: 'SEGES',
    },
  ],
  crops: [RAPESEED, PEAS],
}

describe('cropTotals', () => {
  it('multiplies each quantity by its unit price', () => {
    const totals = cropTotals(ASSUMPTIONS, NO_OVERRIDES, RAPESEED)
    expect(totals.revenueDkkHa).toBe(14740)
    expect(totals.subsidyDkkHa).toBe(1575)
    expect(totals.costsDkkHa.fieldWork).toBe(1945)
    expect(totals.totalCostsDkkHa).toBe(1945)
  })

  it('changes every crop that uses a shared price', () => {
    const overrides = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'ploughing',
      900,
    )
    expect(
      cropTotals(ASSUMPTIONS, overrides, RAPESEED).costsDkkHa.fieldWork,
    ).toBe(2020)
    expect(cropTotals(ASSUMPTIONS, overrides, PEAS).costsDkkHa.fieldWork).toBe(
      1220,
    )
  })

  it('changes a quantity for one crop only', () => {
    const overrides = withQuantityOverride(
      NO_OVERRIDES,
      RAPESEED,
      'spraying',
      5,
    )
    expect(
      cropTotals(ASSUMPTIONS, overrides, RAPESEED).costsDkkHa.fieldWork,
    ).toBe(1625)
    expect(cropTotals(ASSUMPTIONS, overrides, PEAS).costsDkkHa.fieldWork).toBe(
      1145,
    )
  })
})

describe('overrides', () => {
  it('restores the standard when the value is cleared or typed back', () => {
    const changed = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'spraying',
      175,
    )
    expect(isPriceCustomised(changed, 'spraying')).toBe(true)
    expect(
      isPriceCustomised(
        withPriceOverride(ASSUMPTIONS, changed, 'spraying', null),
        'spraying',
      ),
    ).toBe(false)
    expect(
      isPriceCustomised(
        withPriceOverride(ASSUMPTIONS, changed, 'spraying', 160),
        'spraying',
      ),
    ).toBe(false)

    const lessSpraying = withQuantityOverride(
      NO_OVERRIDES,
      RAPESEED,
      'spraying',
      6,
    )
    expect(isQuantityCustomised(lessSpraying, RAPESEED, 'spraying')).toBe(true)
    expect(
      isQuantityCustomised(
        withQuantityOverride(lessSpraying, RAPESEED, 'spraying', 7),
        RAPESEED,
        'spraying',
      ),
    ).toBe(false)
  })

  it('marks a crop as customised when one of its prices or quantities differs', () => {
    const rapeseedOnly = withQuantityOverride(
      NO_OVERRIDES,
      RAPESEED,
      'spraying',
      5,
    )
    expect(isCropCustomised(rapeseedOnly, RAPESEED)).toBe(true)
    expect(isCropCustomised(rapeseedOnly, PEAS)).toBe(false)

    const sharedPrice = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'ploughing',
      900,
    )
    expect(isCropCustomised(sharedPrice, RAPESEED)).toBe(true)
    expect(isCropCustomised(sharedPrice, PEAS)).toBe(true)
  })
})

describe('priceUsage', () => {
  it('counts the crops that use each price', () => {
    const usage = priceUsage(ASSUMPTIONS)
    expect(usage.get('ploughing')).toBe(2)
    expect(usage.get('spraying')).toBe(2)
    expect(usage.get('rapeseedPrice')).toBe(1)
  })
})

describe('EXAMPLE_ECONOMICS', () => {
  it('gives the same Vinterraps figures as the DB2 calculation', () => {
    const rapeseed = EXAMPLE_ECONOMICS.crops.find(
      (example) => example.cropCode === 22,
    )
    if (!rapeseed) throw new Error('Vinterraps is missing')
    const totals = cropTotals(EXAMPLE_ECONOMICS, NO_OVERRIDES, rapeseed)
    expect(totals.revenueDkkHa).toBe(14740)
    expect(totals.subsidyDkkHa).toBe(1575)
    expect(totals.costsDkkHa.seed).toBeCloseTo(562.5)
    expect(totals.costsDkkHa.cropProtection).toBeCloseTo(1734)
    expect(totals.costsDkkHa.fieldWork).toBeCloseTo(4707)
    expect(totals.costsDkkHa.drying).toBeCloseTo(748)
  })
})

describe('parseEconomicsInput', () => {
  it('reads Danish decimals', () => {
    expect(parseEconomicsInput('3,55')).toEqual({ value: 3.55 })
    expect(parseEconomicsInput(' 825 ')).toEqual({ value: 825 })
  })

  it('asks for a number that is not negative', () => {
    expect(parseEconomicsInput('')).toEqual({ error: 'Skriv et tal.' })
    expect(parseEconomicsInput('abc')).toEqual({ error: 'Skriv et tal.' })
    expect(parseEconomicsInput('-1')).toEqual({
      error: 'Tallet kan ikke være negativt.',
    })
  })
})

describe('quantityUnitLabel', () => {
  it('says gang for a single treatment', () => {
    expect(quantityUnitLabel('gange', 1)).toBe('gang')
    expect(quantityUnitLabel('gange', 3)).toBe('gange')
    expect(quantityUnitLabel('kg/ha', 1)).toBe('kg/ha')
  })
})

describe('formatEconomicsNumber', () => {
  it('keeps the two decimals SEGES prices can have', () => {
    expect(formatEconomicsNumber(0.05)).toBe('0,05')
    expect(formatEconomicsNumber(562.5)).toBe('562,5')
    expect(formatEconomicsNumber(1575)).toBe('1.575')
  })
})
