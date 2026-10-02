import { describe, expect, it } from 'vitest'

import {
  cropSources,
  cropTotals,
  cropYieldPct,
  customisedBreakdownLine,
  formatDbDkk,
  formatEconomicsNumber,
  formatYieldPct,
  incomeSplit,
  isCropCustomised,
  isPriceCustomised,
  isQuantityCustomised,
  isYieldCustomised,
  lineGroupId,
  lineQuantity,
  NO_OVERRIDES,
  parseEconomicsInput,
  parseYieldPctInput,
  priceUsage,
  quantityUnitLabel,
  searchCrops,
  stepYieldPct,
  withoutCropChanges,
  withPriceOverride,
  withQuantityOverride,
  withYieldPct,
  YIELD_ADJUSTMENT_ID,
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

describe('dækningsbidrag', () => {
  it('gives the dækningsbidrag as income and subsidy minus costs', () => {
    const totals = cropTotals(ASSUMPTIONS, NO_OVERRIDES, RAPESEED)
    expect(totals.dbDkkHa).toBe(14740 + 1575 - 1945)
    expect(formatDbDkk(totals.dbDkkHa)).toBe('14.370')
    expect(formatDbDkk(-1234)).toBe('−1.234')
  })

  it('splits income and subsidy into the cost groups and the dækningsbidrag', () => {
    const split = incomeSplit(cropTotals(ASSUMPTIONS, NO_OVERRIDES, RAPESEED))
    expect(split.map((part) => part.id)).toEqual(['fieldWork', 'db'])
    expect(split[0].share).toBeCloseTo(1945 / 16315)
    expect(split[1].share).toBeCloseTo(14370 / 16315)
  })

  it('leaves out the dækningsbidrag when the costs are higher than the income', () => {
    expect(
      incomeSplit({
        revenueDkkHa: 100,
        subsidyDkkHa: 0,
        costsDkkHa: { seed: 50, cropProtection: 0, fieldWork: 150, drying: 0 },
        totalCostsDkkHa: 200,
        dbDkkHa: -100,
      }),
    ).toEqual([
      { id: 'seed', valueDkkHa: 50, share: 0.25 },
      { id: 'fieldWork', valueDkkHa: 150, share: 0.75 },
    ])
  })
})

describe('one crop', () => {
  it('restores every change in one crop, shared prices included', () => {
    const rapeseedYield = withYieldPct(NO_OVERRIDES, RAPESEED, 10)
    const rapeseedSpraying = withQuantityOverride(
      rapeseedYield,
      RAPESEED,
      'spraying',
      5,
    )
    const ploughing = withPriceOverride(
      ASSUMPTIONS,
      rapeseedSpraying,
      'ploughing',
      900,
    )
    const peasSpraying = withQuantityOverride(ploughing, PEAS, 'spraying', 3)
    const restored = withoutCropChanges(ASSUMPTIONS, peasSpraying, RAPESEED)
    expect(isCropCustomised(restored, RAPESEED)).toBe(false)
    expect(isPriceCustomised(restored, 'ploughing')).toBe(false)
    expect(isQuantityCustomised(restored, PEAS, 'spraying')).toBe(true)
  })

  it('tells which group a line or the yield adjustment belongs to', () => {
    expect(lineGroupId(RAPESEED, 'grain')).toBe('revenue')
    expect(lineGroupId(RAPESEED, YIELD_ADJUSTMENT_ID)).toBe('revenue')
    expect(lineGroupId(RAPESEED, 'basicPayment')).toBe('subsidy')
    expect(lineGroupId(RAPESEED, 'spraying')).toBe('fieldWork')
    expect(lineGroupId(RAPESEED, 'missing')).toBeNull()
  })

  it('names each source of its prices once', () => {
    expect(cropSources(ASSUMPTIONS, RAPESEED)).toEqual(['SEGES', 'Prisliste'])
  })

  it('finds crops by part of their name', () => {
    expect(searchCrops([RAPESEED, PEAS], ' raps ')).toEqual([RAPESEED])
    expect(searchCrops([RAPESEED, PEAS], 'ÆR')).toEqual([PEAS])
    expect(searchCrops([RAPESEED, PEAS], '')).toEqual([RAPESEED, PEAS])
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

describe('yield percentage', () => {
  it('raises or lowers the yield of one crop and leaves its costs alone', () => {
    const [grain] = RAPESEED.revenue
    const moreYield = withYieldPct(NO_OVERRIDES, RAPESEED, 10)
    expect(lineQuantity(moreYield, RAPESEED, grain)).toBeCloseTo(48.4)
    expect(
      cropTotals(ASSUMPTIONS, moreYield, RAPESEED).revenueDkkHa,
    ).toBeCloseTo(16214)
    expect(cropTotals(ASSUMPTIONS, moreYield, RAPESEED).costsDkkHa).toEqual(
      cropTotals(ASSUMPTIONS, NO_OVERRIDES, RAPESEED).costsDkkHa,
    )
    expect(
      lineQuantity(withYieldPct(NO_OVERRIDES, RAPESEED, -25), RAPESEED, grain),
    ).toBe(33)
    expect(isCropCustomised(moreYield, RAPESEED)).toBe(true)
    expect(isCropCustomised(moreYield, PEAS)).toBe(false)
  })

  it('goes back to the standard when the percentage is cleared or set to 0', () => {
    const moreYield = withYieldPct(NO_OVERRIDES, RAPESEED, 10)
    expect(cropYieldPct(moreYield, RAPESEED)).toBe(10)
    expect(isYieldCustomised(moreYield, RAPESEED)).toBe(true)
    expect(
      isYieldCustomised(withYieldPct(moreYield, RAPESEED, null), RAPESEED),
    ).toBe(false)
    expect(
      isYieldCustomised(withYieldPct(moreYield, RAPESEED, 0), RAPESEED),
    ).toBe(false)
  })

  it('steps the percentage by 5 and stays above -100', () => {
    expect(stepYieldPct(10, 1)).toBe(15)
    expect(stepYieldPct(-90, -1)).toBe(-95)
    expect(stepYieldPct(-95, -1)).toBe(-95)
  })

  it('reads a percentage above -100 and shows its sign', () => {
    expect(parseYieldPctInput('12,5')).toEqual({ value: 12.5 })
    expect(parseYieldPctInput('-15')).toEqual({ value: -15 })
    expect(parseYieldPctInput('−15')).toEqual({ value: -15 })
    expect(parseYieldPctInput('-100')).toEqual({
      error: 'Skriv et tal over -100.',
    })
    expect(parseYieldPctInput('mere')).toEqual({ error: 'Skriv et tal.' })
    expect(formatYieldPct(10)).toBe('+10')
    expect(formatYieldPct(-12.5)).toBe('−12,5')
    expect(formatYieldPct(0)).toBe('0')
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

describe('customisedBreakdownLine', () => {
  const BARLEY = crop(1, 'Vårbyg', {
    revenue: [
      line('Udbytte', 66, 'hkg/ha', 'barleyPrice'),
      line('Halm', 3500, 'kg/ha', 'strawPrice'),
    ],
  })
  const WITH_BARLEY: EconomicsAssumptions = {
    prices: [
      ...ASSUMPTIONS.prices,
      {
        id: 'barleyPrice',
        label: 'Salgspris',
        unit: 'kr/hkg',
        valueDkk: 140,
        source: 'SEGES',
      },
      {
        id: 'strawPrice',
        label: 'Halmpris',
        unit: 'kr/kg',
        valueDkk: 0.6,
        source: 'SEGES',
      },
    ],
    crops: [...ASSUMPTIONS.crops, BARLEY],
  }
  const ploughing = {
    kind: 'cost',
    category: 'Markarbejde',
    treatment: 'ploughing',
  } as const
  const spraying = {
    kind: 'cost',
    category: 'Markarbejde',
    treatment: 'spraying',
  } as const

  it('marks a cost line whose unit price or quantity is changed', () => {
    expect(
      customisedBreakdownLine(ASSUMPTIONS, NO_OVERRIDES, 22, ploughing),
    ).toBeNull()
    const ploughingPrice = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'ploughing',
      900,
    )
    expect(
      customisedBreakdownLine(ASSUMPTIONS, ploughingPrice, 22, ploughing)?.id,
    ).toBe('ploughing')
    expect(
      customisedBreakdownLine(ASSUMPTIONS, ploughingPrice, 30, ploughing)?.id,
    ).toBe('ploughing')
    const peasSpraying = withQuantityOverride(NO_OVERRIDES, PEAS, 'spraying', 3)
    expect(
      customisedBreakdownLine(ASSUMPTIONS, peasSpraying, 30, spraying)?.id,
    ).toBe('spraying')
    expect(
      customisedBreakdownLine(ASSUMPTIONS, peasSpraying, 22, spraying),
    ).toBeNull()
  })

  it('tells a changed yield from a changed sale price', () => {
    const moreYield = withYieldPct(NO_OVERRIDES, BARLEY, 10)
    expect(
      customisedBreakdownLine(WITH_BARLEY, moreYield, 1, { kind: 'yield' })?.id,
    ).toBe(YIELD_ADJUSTMENT_ID)
    expect(
      customisedBreakdownLine(WITH_BARLEY, moreYield, 1, { kind: 'salePrice' }),
    ).toBeNull()
    const higherPrice = withPriceOverride(
      WITH_BARLEY,
      NO_OVERRIDES,
      'barleyPrice',
      150,
    )
    expect(
      customisedBreakdownLine(WITH_BARLEY, higherPrice, 1, {
        kind: 'salePrice',
      })?.id,
    ).toBe('Udbytte')
    expect(
      customisedBreakdownLine(WITH_BARLEY, higherPrice, 1, { kind: 'yield' }),
    ).toBeNull()
  })

  it('marks Indtægt for halm and Tilskud for a subsidy', () => {
    const strawPrice = withPriceOverride(
      WITH_BARLEY,
      NO_OVERRIDES,
      'strawPrice',
      0.8,
    )
    expect(
      customisedBreakdownLine(WITH_BARLEY, strawPrice, 1, { kind: 'revenue' })
        ?.id,
    ).toBe('Halm')
    const moreYield = withYieldPct(NO_OVERRIDES, BARLEY, 10)
    expect(
      customisedBreakdownLine(WITH_BARLEY, moreYield, 1, { kind: 'revenue' }),
    ).toBeNull()
    const basicPayment = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'basicPayment',
      1600,
    )
    expect(
      customisedBreakdownLine(ASSUMPTIONS, basicPayment, 22, {
        kind: 'subsidy',
      })?.id,
    ).toBe('basicPayment')
  })

  it('finds nothing outside the assumptions', () => {
    const ploughingPrice = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'ploughing',
      900,
    )
    expect(
      customisedBreakdownLine(ASSUMPTIONS, ploughingPrice, 999, ploughing),
    ).toBeNull()
    expect(
      customisedBreakdownLine(ASSUMPTIONS, ploughingPrice, 22, {
        ...ploughing,
        category: 'Gødning',
      }),
    ).toBeNull()
  })
})
