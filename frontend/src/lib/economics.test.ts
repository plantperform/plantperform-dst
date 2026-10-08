import { describe, expect, it } from 'vitest'

import {
  categoryPrices,
  compareProfileChanges,
  cropSources,
  cropTotals,
  cropYieldPct,
  customisedBreakdownLine,
  dbDeltaBar,
  dbDeltaScale,
  describePriceCrops,
  describeProfileChanges,
  FERTILISER_PRICE_IDS,
  formatChangeCount,
  formatDbDkk,
  formatEconomicsNumber,
  formatSignedDkk,
  formatYieldPct,
  isCropCustomised,
  isPriceCustomised,
  isQuantityCustomised,
  isYieldCustomised,
  lineGroupId,
  lineQuantity,
  NO_OVERRIDES,
  parseEconomicsInput,
  parseYieldPctInput,
  priceCrops,
  profileChanges,
  profileChangesTitle,
  profileDbEffect,
  quantityUnitLabel,
  sameOverrides,
  sharedPriceEffect,
  stepYieldPct,
  withFertiliserPlan,
  withoutCropChanges,
  withoutProfileChange,
  withPriceOverride,
  withQuantityOverride,
  withYieldPct,
  YIELD_ADJUSTMENT_ID,
  yieldHint,
  type CropDbEffect,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsLine,
  type ProfileChange,
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
    fertiliser: [],
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

describe('profileDbEffect', () => {
  it('gives the dækningsbidrag of every crop in a profile and what it moves', () => {
    expect(profileDbEffect(ASSUMPTIONS, NO_OVERRIDES)).toEqual([
      { cropCode: 22, cropName: 'Vinterraps', dbDkkHa: 14370, deltaDkkHa: 0 },
      { cropCode: 30, cropName: 'Ærter', dbDkkHa: -1145, deltaDkkHa: 0 },
    ])
    const moreWork = withQuantityOverride(
      withPriceOverride(ASSUMPTIONS, NO_OVERRIDES, 'spraying', 150),
      PEAS,
      'ploughing',
      2,
    )
    expect(profileDbEffect(ASSUMPTIONS, moreWork)).toEqual([
      { cropCode: 22, cropName: 'Vinterraps', dbDkkHa: 14440, deltaDkkHa: 70 },
      { cropCode: 30, cropName: 'Ærter', dbDkkHa: -1950, deltaDkkHa: -805 },
    ])
  })

  const effect = (cropCode: number, deltaDkkHa: number): CropDbEffect => ({
    cropCode,
    cropName: `Afgrøde ${cropCode}`,
    dbDkkHa: 1000,
    deltaDkkHa,
  })

  it('places each move on a scale from the largest fall to the largest rise', () => {
    const scale = dbDeltaScale([effect(1, 300), effect(2, -100), effect(3, 0)])
    expect(scale).toEqual({ down: 100, up: 300 })
    expect(dbDeltaBar(300, scale)).toEqual({ axis: 0.25, width: 0.75 })
    expect(dbDeltaBar(-100, scale)).toEqual({ axis: 0.25, width: 0.25 })
    expect(dbDeltaBar(0, scale)).toEqual({ axis: 0.25, width: 0 })
  })

  it('draws no bar when no crop moves', () => {
    const scale = dbDeltaScale([effect(1, 0)])
    expect(scale).toEqual({ down: 0, up: 0 })
    expect(dbDeltaBar(0, scale)).toEqual({ axis: 0, width: 0 })
  })
})

describe('sameOverrides', () => {
  it('compares the changes whatever order they were made in', () => {
    const left = {
      prices: { spraying: 150, ploughing: 700 },
      quantities: {},
      yieldPct: { '22': 10 },
    }
    const right = {
      prices: { ploughing: 700, spraying: 150 },
      quantities: {},
      yieldPct: { '22': 10 },
    }
    expect(sameOverrides(left, right)).toBe(true)
    expect(sameOverrides(NO_OVERRIDES, NO_OVERRIDES)).toBe(true)
  })

  it('tells a changed, an added and a removed value apart', () => {
    const base = { prices: { spraying: 150 }, quantities: {}, yieldPct: {} }
    expect(sameOverrides(base, { ...base, prices: { spraying: 160 } })).toBe(
      false,
    )
    expect(sameOverrides(base, { ...base, yieldPct: { '22': 5 } })).toBe(false)
    expect(sameOverrides(base, NO_OVERRIDES)).toBe(false)
  })
})

describe('dækningsbidrag', () => {
  it('gives the dækningsbidrag as income and subsidy minus costs', () => {
    const totals = cropTotals(ASSUMPTIONS, NO_OVERRIDES, RAPESEED)
    expect(totals.dbDkkHa).toBe(14740 + 1575 - 1945)
    expect(formatDbDkk(totals.dbDkkHa)).toBe('14.370')
    expect(formatDbDkk(-1234)).toBe('−1.234')
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
    expect(parseYieldPctInput('+10')).toEqual({ value: 10 })
    expect(parseYieldPctInput('-100')).toEqual({
      error: 'Skriv et tal over −100.',
    })
    expect(parseYieldPctInput('mere')).toEqual({ error: 'Skriv et tal.' })
    expect(formatYieldPct(10)).toBe('+10')
    expect(formatYieldPct(-12.5)).toBe('−12,5')
    expect(formatYieldPct(0)).toBe('0')
  })
})

describe('yieldHint', () => {
  it('tells what the percentage does to grain and straw', () => {
    expect(yieldHint(NO_OVERRIDES, BARLEY)).toBe(
      'Normen er 66 hkg kerne og 3.500 kg halm pr. ha. Procenten ændrer begge, men ikke omkostningerne.',
    )
    expect(yieldHint(withYieldPct(NO_OVERRIDES, BARLEY, 10), BARLEY)).toBe(
      '+10 % giver 72,6 hkg kerne og 3.850 kg halm pr. ha. Omkostningerne ændrer sig ikke.',
    )
  })

  it('leaves the straw out for a crop without it', () => {
    expect(yieldHint(NO_OVERRIDES, RAPESEED)).toBe(
      'Normen er 44 hkg pr. ha. Procenten ændrer mængden, men ikke omkostningerne.',
    )
    expect(yieldHint(withYieldPct(NO_OVERRIDES, RAPESEED, -25), RAPESEED)).toBe(
      '−25 % giver 33 hkg pr. ha. Omkostningerne ændrer sig ikke.',
    )
    expect(yieldHint(NO_OVERRIDES, PEAS)).toBe('')
  })
})

describe('profileChanges', () => {
  const overrides = withYieldPct(
    withQuantityOverride(
      withPriceOverride(
        ASSUMPTIONS,
        withPriceOverride(ASSUMPTIONS, NO_OVERRIDES, 'ploughing', 700),
        'rapeseedPrice',
        350,
      ),
      PEAS,
      'spraying',
      3,
    ),
    RAPESEED,
    10,
  )

  it('lists the yield, each changed price once and each changed quantity', () => {
    expect(profileChanges(ASSUMPTIONS, overrides)).toEqual([
      {
        key: 'yield:22',
        kind: 'yield',
        label: 'Udbytte i forhold til normen',
        cropNames: ['Vinterraps'],
        from: '0 %',
        to: '+10 %',
        guideStep: 3,
      },
      {
        key: 'price:rapeseedPrice',
        kind: 'price',
        label: 'Salgspris',
        cropNames: ['Vinterraps'],
        from: '335 kr/hkg',
        to: '350 kr/hkg',
        guideStep: 1,
      },
      {
        key: 'price:ploughing',
        kind: 'price',
        label: 'Pløjning med pakning',
        cropNames: ['Vinterraps', 'Ærter'],
        from: '825 kr/gang',
        to: '700 kr/gang',
        guideStep: 4,
      },
      {
        key: 'quantity:30/spraying',
        kind: 'quantity',
        label: 'spraying, mængde',
        cropNames: ['Ærter'],
        from: '2 gange',
        to: '3 gange',
        guideStep: null,
      },
    ])
    expect(profileChanges(ASSUMPTIONS, NO_OVERRIDES)).toEqual([])
  })

  it('sends a changed gødning price to the Gødning step', () => {
    expect(
      profileChanges(
        EXAMPLE_ECONOMICS,
        withPriceOverride(
          EXAMPLE_ECONOMICS,
          NO_OVERRIDES,
          FERTILISER_PRICE_IDS.mineralN,
          14,
        ),
      ),
    ).toMatchObject([
      {
        label: 'Handelsgødning, kvælstof (N)',
        from: '12,5 kr/kg N',
        to: '14 kr/kg N',
        guideStep: 2,
      },
    ])
  })

  it('names a changed straw price and keeps it out of the guide steps', () => {
    expect(
      profileChanges(
        WITH_BARLEY,
        withPriceOverride(WITH_BARLEY, NO_OVERRIDES, 'strawPrice', 0.7),
      ),
    ).toMatchObject([{ label: 'Halmpris', guideStep: null }])
  })

  it('lines the changes of several profiles up against Standard', () => {
    const cheaperPloughing = withPriceOverride(
      ASSUMPTIONS,
      NO_OVERRIDES,
      'ploughing',
      650,
    )
    expect(
      compareProfileChanges([
        [],
        profileChanges(ASSUMPTIONS, overrides),
        profileChanges(ASSUMPTIONS, cheaperPloughing),
      ]).map((row) => [row.label, ...row.cells.map((cell) => cell.value)]),
    ).toEqual([
      ['Udbytte i forhold til normen', '0 %', '+10 %', '0 %'],
      ['Salgspris', '335 kr/hkg', '350 kr/hkg', '335 kr/hkg'],
      ['Pløjning med pakning', '825 kr/gang', '700 kr/gang', '650 kr/gang'],
      ['spraying, mængde', '2 gange', '3 gange', '2 gange'],
    ])
    expect(
      compareProfileChanges([
        [],
        profileChanges(ASSUMPTIONS, cheaperPloughing),
      ])[0].cells,
    ).toEqual([
      { value: '825 kr/gang', changed: false },
      { value: '650 kr/gang', changed: true },
    ])
    expect(compareProfileChanges([[], []])).toEqual([])
  })

  it('counts the changes in a heading', () => {
    expect(profileChangesTitle(0)).toBe(
      'Ingen ændringer i forhold til Standard',
    )
    expect(profileChangesTitle(1)).toBe('1 ændring i forhold til Standard')
    expect(profileChangesTitle(3)).toBe('3 ændringer i forhold til Standard')
    expect(formatChangeCount(0)).toBe('Ingen ændringer')
    expect(formatChangeCount(1)).toBe('1 ændring')
    expect(formatChangeCount(3)).toBe('3 ændringer')
  })

  it('sums up the changes of a profile by kind', () => {
    const change = (
      kind: ProfileChange['kind'],
      cropName: string,
    ): ProfileChange => ({
      key: `${kind}:${cropName}`,
      kind,
      label: '',
      cropNames: [cropName],
      from: '',
      to: '',
      guideStep: null,
    })
    expect(describeProfileChanges([])).toBe('Samme tal som Standard')
    expect(describeProfileChanges([change('yield', 'Vårbyg')])).toBe(
      'Udbytte for Vårbyg',
    )
    expect(
      describeProfileChanges([
        change('yield', 'Vårbyg'),
        change('yield', 'Vinterbyg'),
        change('yield', 'Vinterraps'),
        change('yield', 'Ærter'),
        change('price', 'Vinterraps'),
        change('quantity', 'Vinterbyg'),
      ]),
    ).toBe('Udbytte for 4 afgrøder, 1 pris og 1 mængde')
    expect(
      describeProfileChanges([
        change('price', 'Vårbyg'),
        change('price', 'Ærter'),
        change('quantity', 'Vårbyg'),
        change('quantity', 'Ærter'),
        change('quantity', 'Vinterraps'),
      ]),
    ).toBe('2 priser og 3 mængder')
  })

  it('restores one change and keeps the others', () => {
    const keysWithout = (key: string) => {
      const change = profileChanges(ASSUMPTIONS, overrides).find(
        (entry) => entry.key === key,
      )
      if (!change) throw new Error(`${key} is missing`)
      return profileChanges(
        ASSUMPTIONS,
        withoutProfileChange(overrides, change),
      ).map((entry) => entry.key)
    }
    expect(keysWithout('yield:22')).toEqual([
      'price:rapeseedPrice',
      'price:ploughing',
      'quantity:30/spraying',
    ])
    expect(keysWithout('price:ploughing')).toEqual([
      'yield:22',
      'price:rapeseedPrice',
      'quantity:30/spraying',
    ])
    expect(keysWithout('quantity:30/spraying')).toEqual([
      'yield:22',
      'price:rapeseedPrice',
      'price:ploughing',
    ])
  })
})

describe('shared prices', () => {
  it('names the crops that use a price', () => {
    expect(
      priceCrops(ASSUMPTIONS, 'ploughing').map((entry) => entry.cropName),
    ).toEqual(['Vinterraps', 'Ærter'])
    expect(priceCrops(ASSUMPTIONS, 'rapeseedPrice')).toEqual([RAPESEED])
  })

  it('tells what a new price does to the dækningsbidrag of each crop', () => {
    expect(
      sharedPriceEffect(ASSUMPTIONS, NO_OVERRIDES, 'spraying', 150),
    ).toEqual([
      { cropName: 'Vinterraps', deltaDkkHa: 70 },
      { cropName: 'Ærter', deltaDkkHa: 20 },
    ])
  })

  it('names the crops of a price, or all of them at once', () => {
    expect(describePriceCrops(ASSUMPTIONS, 'rapeseedPrice')).toBe('Vinterraps')
    expect(describePriceCrops(ASSUMPTIONS, 'ploughing')).toBe('Alle 2 afgrøder')
  })
})

describe('EXAMPLE_ECONOMICS', () => {
  it('has a price for every line and no two lines with the same id in a crop', () => {
    const priceIds = new Set(EXAMPLE_ECONOMICS.prices.map((price) => price.id))
    for (const example of EXAMPLE_ECONOMICS.crops) {
      const lines = [
        ...example.revenue,
        ...example.subsidies,
        ...Object.values(example.costs).flat(),
      ]
      expect(lines.filter((entry) => !priceIds.has(entry.priceId))).toEqual([])
      expect(new Set(lines.map((entry) => entry.id)).size).toBe(lines.length)
    }
  })
})

describe('gødning', () => {
  const WHEAT = 11
  const exampleCrop = (assumptions: EconomicsAssumptions, cropCode: number) => {
    const found = assumptions.crops.find((entry) => entry.cropCode === cropCode)
    if (!found) throw new Error(`No crop ${cropCode} in the example`)
    return found
  }
  const wheatQuantities = (plan: Parameters<typeof withFertiliserPlan>[1]) =>
    exampleCrop(
      withFertiliserPlan(EXAMPLE_ECONOMICS, plan),
      WHEAT,
    ).costs.fertiliser.map((entry) => entry.quantity)

  it('prices the kvælstofnorm as handelsgødning in the standard', () => {
    expect(
      cropTotals(
        EXAMPLE_ECONOMICS,
        NO_OVERRIDES,
        exampleCrop(EXAMPLE_ECONOMICS, WHEAT),
      ).costsDkkHa.fertiliser,
    ).toBe(206 * 12.5 + 115)
    expect(exampleCrop(EXAMPLE_ECONOMICS, 30).costs.fertiliser).toEqual([])
  })

  it('lists the four prices of the Gødning step', () => {
    expect(
      categoryPrices(EXAMPLE_ECONOMICS, 'fertiliser').map((price) => price.id),
    ).toEqual(Object.values(FERTILISER_PRICE_IDS))
  })

  it('keeps the standard quantities in a simulation without husdyrgødning', () => {
    expect(
      wheatQuantities({
        orgMineralN: 0,
        onlyOrganic: false,
        nContentKgPerTon: 0,
      }),
    ).toEqual([206, 1, 0, 0])
  })

  it('lets the husdyrgødning of a simulation replace handelsgødning', () => {
    expect(
      wheatQuantities({
        orgMineralN: 100,
        onlyOrganic: false,
        nContentKgPerTon: 5,
      }),
    ).toEqual([106, 1, 100, 20])
  })

  it('spreads no handelsgødning when the husdyrgødning covers the norm', () => {
    expect(
      wheatQuantities({
        orgMineralN: 250,
        onlyOrganic: false,
        nContentKgPerTon: 5,
      }),
    ).toEqual([0, 0, 206, 41.2])
  })

  it('tops nothing up with handelsgødning when only organic gødning is used', () => {
    expect(
      wheatQuantities({
        orgMineralN: 100,
        onlyOrganic: true,
        nContentKgPerTon: 5,
      }),
    ).toEqual([0, 0, 100, 20])
  })

  it('finds the handelsgødning line although the backend adds the amount to its name', () => {
    const dearerNitrogen = withPriceOverride(
      EXAMPLE_ECONOMICS,
      NO_OVERRIDES,
      FERTILISER_PRICE_IDS.mineralN,
      14,
    )
    expect(
      customisedBreakdownLine(EXAMPLE_ECONOMICS, dearerNitrogen, WHEAT, {
        kind: 'cost',
        category: 'Gødning',
        treatment: 'Handelsgødning, N (206 kg/ha)',
      })?.id,
    ).toBe('Handelsgødning, N')
  })
})

describe('parseEconomicsInput', () => {
  it('reads Danish decimals', () => {
    expect(parseEconomicsInput('3,55')).toEqual({ value: 3.55 })
    expect(parseEconomicsInput(' 825 ')).toEqual({ value: 825 })
  })

  it('reads a full stop as thousands only between groups of three digits', () => {
    expect(parseEconomicsInput('1.575')).toEqual({ value: 1575 })
    expect(parseEconomicsInput('1.575,5')).toEqual({ value: 1575.5 })
    expect(parseEconomicsInput('0.6')).toEqual({ value: 0.6 })
    expect(parseEconomicsInput('0.125')).toEqual({ value: 0.13 })
    expect(parseEconomicsInput('1,2,3')).toEqual({ error: 'Skriv et tal.' })
    expect(parseEconomicsInput('1.5.5')).toEqual({ error: 'Skriv et tal.' })
  })

  it('keeps the two decimals the fields show', () => {
    expect(parseEconomicsInput('0,055')).toEqual({ value: 0.06 })
  })

  it('asks for a number that is not negative', () => {
    expect(parseEconomicsInput('')).toEqual({ error: 'Skriv et tal.' })
    expect(parseEconomicsInput('abc')).toEqual({ error: 'Skriv et tal.' })
    expect(parseEconomicsInput('9'.repeat(400))).toEqual({
      error: 'Skriv et tal.',
    })
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

describe('formatSignedDkk', () => {
  it('shows the sign of a difference in whole kroner', () => {
    expect(formatSignedDkk(1985.4)).toBe('+1.985')
    expect(formatSignedDkk(-125)).toBe('−125')
    expect(formatSignedDkk(0)).toBe('0')
    expect(formatSignedDkk(-0.4)).toBe('0')
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
