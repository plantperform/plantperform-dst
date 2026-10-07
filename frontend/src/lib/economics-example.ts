import {
  COST_CATEGORIES,
  FERTILISER_PRICE_IDS,
  type CostCategory,
  type CropEconomics,
  type EconomicsAssumptions,
  type EconomicsLine,
} from '@/lib/economics'

type PriceRow = [id: string, label: string, unit: string, valueDkk: number]

type LineRow = [
  label: string,
  quantity: number,
  quantityUnit: string,
  priceId: string,
]

type CropRow = Omit<CropEconomics, 'revenue' | 'subsidies' | 'costs'> & {
  revenue: LineRow[]
  subsidies: LineRow[]
  costs: Record<CostCategory, LineRow[]>
}

export const STANDARD_SOURCE = 'SEGES Budgetkalkuler 2026'
const PRICE_LIST = 'Prisliste 2026'

const SEGES_PRICES: PriceRow[] = [
  ['rate:Analyser', 'Analyser', 'kr/gang', 115],
  ['rate:Bejdsning v. lægning:151', 'Bejdsning v. lægning', 'kr/gang', 149],
  ['rate:Efterharvning', 'Efterharvning', 'kr/gang', 275],
  ['rate:Fragt', 'Fragt', 'kr/kg', 0.05],
  ['rate:Gødningsspredning', 'Gødningsspredning', 'kr/gang', 115],
  ['rate:Halmpresning', 'Halmpresning', 'kr/kg', 0.2],
  ['rate:Hjemkørsel, halm', 'Hjemkørsel, halm', 'kr/gang', 298],
  ['rate:Hjemkørsel, halm:10', 'Hjemkørsel, halm', 'kr/gang', 316],
  ['rate:Hjemkørsel, halm:11', 'Hjemkørsel, halm', 'kr/gang', 339],
  ['rate:Hjemkørsel, korn:1', 'Hjemkørsel, korn', 'kr/gang', 446],
  ['rate:Hjemkørsel, korn:10', 'Hjemkørsel, korn', 'kr/gang', 496],
  ['rate:Hjemkørsel, korn:11', 'Hjemkørsel, korn', 'kr/gang', 528],
  ['rate:Hjemkørsel, raps', 'Hjemkørsel, raps', 'kr/gang', 475],
  ['rate:Hjemkørsel, ærter', 'Hjemkørsel, ærter', 'kr/gang', 350],
  ['rate:Komb. harvning og såning', 'Komb. harvning og såning', 'kr/gang', 450],
  [
    'rate:Komb. harvning og såning:10',
    'Komb. harvning og såning',
    'kr/gang',
    400,
  ],
  [
    'rate:Komb. harvning og såning:11',
    'Komb. harvning og såning',
    'kr/gang',
    400,
  ],
  [
    'rate:Komb. harvning og såning:22',
    'Komb. harvning og såning',
    'kr/gang',
    400,
  ],
  ['rate:Læggekartofler egen avl', 'Læggekartofler egen avl', 'kr/kg', 1.25],
  ['rate:Læggekartofler indkøbt', 'Læggekartofler indkøbt', 'kr/kg', 2.5],
  [
    'rate:Lægning m. gødn. placering',
    'Lægning m. gødn. placering',
    'kr/gang',
    1650,
  ],
  ['rate:Mejetærskning:1', 'Mejetærskning', 'kr/gang', 998],
  ['rate:Mejetærskning:10', 'Mejetærskning', 'kr/gang', 1108],
  ['rate:Mejetærskning:11', 'Mejetærskning', 'kr/gang', 1180],
  ['rate:Mejetærskning:22', 'Mejetærskning', 'kr/gang', 1128],
  ['rate:Mejetærskning:30', 'Mejetærskning', 'kr/gang', 1300],
  ['rate:Opbevaring i kule', 'Opbevaring i kule', 'kr/gang', 1000],
  ['rate:Optagning:151', 'Optagning', 'kr/gang', 3678],
  ['rate:Pløjning med pakning', 'Pløjning med pakning', 'kr/gang', 825],
  ['rate:Pløjning med pakning:10', 'Pløjning med pakning', 'kr/gang', 725],
  ['rate:Pløjning med pakning:11', 'Pløjning med pakning', 'kr/gang', 725],
  ['rate:Pløjning med pakning:22', 'Pløjning med pakning', 'kr/gang', 725],
  ['rate:Rensning', 'Rensning', 'kr/kg', 0.06],
  ['rate:Skadedyr', 'Skadedyr', 'kr/gang', 33],
  ['rate:Skadedyr:10', 'Skadedyr', 'kr/gang', 53],
  ['rate:Skadedyr:11', 'Skadedyr', 'kr/gang', 104],
  ['rate:Skadedyr:151', 'Skadedyr', 'kr/gang', 255],
  ['rate:Skadedyr:22', 'Skadedyr', 'kr/gang', 335],
  ['rate:Skadedyr:30', 'Skadedyr', 'kr/gang', 108],
  ['rate:Sprøjtning', 'Sprøjtning', 'kr/gang', 160],
  ['rate:Sprøjtning:151', 'Sprøjtning', 'kr/gang', 190],
  ['rate:Stenstrenglægning', 'Stenstrenglægning', 'kr/gang', 2900],
  ['rate:Sygdom:1', 'Sygdom', 'kr/gang', 207],
  ['rate:Sygdom:10', 'Sygdom', 'kr/gang', 319],
  ['rate:Sygdom:11', 'Sygdom', 'kr/gang', 558],
  ['rate:Sygdom:151', 'Sygdom', 'kr/gang', 5477],
  ['rate:Sygdom:22', 'Sygdom', 'kr/gang', 354],
  ['rate:Sygdom:30', 'Sygdom', 'kr/gang', 42],
  ['rate:Såbedsharvning', 'Såbedsharvning', 'kr/gang', 250],
  ['rate:Tromling:30', 'Tromling', 'kr/gang', 225],
  ['rate:Tørring, korn', 'Tørring, korn', 'kr/kg', 0.1],
  ['rate:Tørring, raps', 'Tørring, raps', 'kr/kg', 0.17],
  ['rate:Tørring, ærter', 'Tørring, ærter', 'kr/kg', 0.13],
  ['rate:Udsæd', 'Udsæd', 'kr/kg', 3.35],
  ['rate:Udsæd:1', 'Udsæd', 'kr/kg', 3.55],
  ['rate:Udsæd:10', 'Udsæd', 'kr/kg', 3.5],
  ['rate:Udsæd:22', 'Udsæd', 'kr/enhed', 2250],
  ['rate:Udsæd:30', 'Udsæd', 'kr/kg', 4.1],
  ['rate:Ukrudt', 'Ukrudt', 'kr/gang', 1060],
  ['rate:Ukrudt:1', 'Ukrudt', 'kr/gang', 152],
  ['rate:Ukrudt:10', 'Ukrudt', 'kr/gang', 343],
  ['rate:Ukrudt:11', 'Ukrudt', 'kr/gang', 599],
  ['rate:Ukrudt:22', 'Ukrudt', 'kr/gang', 879],
  ['rate:Ukrudt:30', 'Ukrudt', 'kr/gang', 733],
  ['rate:Vækstregulering', 'Vækstregulering', 'kr/gang', 36],
  ['rate:Vækstregulering:10', 'Vækstregulering', 'kr/gang', 140],
  ['rate:Vækstregulering:11', 'Vækstregulering', 'kr/gang', 59],
  ['rate:Vækstregulering:22', 'Vækstregulering', 'kr/gang', 51],
  ['rate:Øvrige opgaver m.v.', 'Øvrige opgaver m.v.', 'kr/gang', 250],
  ['sale:1', 'Salgspris', 'kr/hkg', 140],
  ['sale:10', 'Salgspris', 'kr/hkg', 140],
  ['sale:11', 'Salgspris', 'kr/hkg', 145],
  ['sale:151', 'Salgspris', 'kr/hkg', 95],
  ['sale:22', 'Salgspris', 'kr/hkg', 335],
  ['sale:30', 'Salgspris', 'kr/hkg', 200],
  ['straw:1', 'Halmpris', 'kr/kg', 0.6],
  ['straw:10', 'Halmpris', 'kr/kg', 0.6],
  ['straw:11', 'Halmpris', 'kr/kg', 0.6],
]

const FERTILISER_PRICES: PriceRow[] = [
  [
    FERTILISER_PRICE_IDS.mineralN,
    'Handelsgødning, kvælstof (N)',
    'kr/kg N',
    12.5,
  ],
  [
    FERTILISER_PRICE_IDS.mineralSpreading,
    'Udbringning, handelsgødning',
    'kr/ha',
    115,
  ],
  [FERTILISER_PRICE_IDS.manureN, 'Husdyrgødning, kvælstof (N)', 'kr/kg N', 0],
  [
    FERTILISER_PRICE_IDS.manureSpreading,
    'Udbringning, husdyrgødning',
    'kr/ton',
    24,
  ],
]

const fertiliser = (nNormKgHa: number): LineRow[] => [
  ['Handelsgødning, N', nNormKgHa, 'kg N/ha', FERTILISER_PRICE_IDS.mineralN],
  [
    'Udbringning, handelsgødning',
    1,
    'ha',
    FERTILISER_PRICE_IDS.mineralSpreading,
  ],
  ['Husdyrgødning, N', 0, 'kg N/ha', FERTILISER_PRICE_IDS.manureN],
  [
    'Udbringning, husdyrgødning',
    0,
    'ton/ha',
    FERTILISER_PRICE_IDS.manureSpreading,
  ],
]

const SUBSIDY_PRICES: PriceRow[] = [
  ['subsidy:Grundbetaling', 'Grundbetaling', 'kr/ha', 1575],
  ['subsidy:Stivelseskartofler', 'Støtte til stivelseskartofler', 'kr/ha', 253],
]

const CROPS: CropRow[] = [
  {
    cropCode: 1,
    cropName: 'Vårbyg',
    precedingCropValueKgNHa: 0,
    revenue: [
      ['Udbytte', 66, 'hkg/ha', 'sale:1'],
      ['Halm', 3500, 'kg/ha', 'straw:1'],
    ],
    subsidies: [['Grundbetaling', 1, 'ha', 'subsidy:Grundbetaling']],
    costs: {
      fertiliser: fertiliser(140),
      seed: [['Udsæd', 140, 'kg/ha', 'rate:Udsæd:1']],
      cropProtection: [
        ['Ukrudt', 1, 'gange', 'rate:Ukrudt:1'],
        ['Sygdom', 1, 'gange', 'rate:Sygdom:1'],
        ['Skadedyr', 1, 'gange', 'rate:Skadedyr'],
        ['Vækstregulering', 1, 'gange', 'rate:Vækstregulering'],
      ],
      fieldWork: [
        ['Halmpresning', 3500, 'kg/ha', 'rate:Halmpresning'],
        ['Pløjning med pakning', 1, 'gange', 'rate:Pløjning med pakning'],
        ['Gødningsspredning', 1, 'gange', 'rate:Gødningsspredning'],
        [
          'Komb. harvning og såning',
          1,
          'gange',
          'rate:Komb. harvning og såning',
        ],
        ['Sprøjtning', 3, 'gange', 'rate:Sprøjtning'],
        ['Mejetærskning', 1, 'gange', 'rate:Mejetærskning:1'],
        ['Hjemkørsel, korn', 1, 'gange', 'rate:Hjemkørsel, korn:1'],
        ['Hjemkørsel, halm', 1, 'gange', 'rate:Hjemkørsel, halm'],
        ['Øvrige opgaver m.v.', 1, 'gange', 'rate:Øvrige opgaver m.v.'],
      ],
      drying: [['Tørring, korn', 6600, 'kg/ha', 'rate:Tørring, korn']],
    },
  },
  {
    cropCode: 10,
    cropName: 'Vinterbyg',
    precedingCropValueKgNHa: 0,
    revenue: [
      ['Udbytte', 77, 'hkg/ha', 'sale:10'],
      ['Halm', 3900, 'kg/ha', 'straw:10'],
    ],
    subsidies: [['Grundbetaling', 1, 'ha', 'subsidy:Grundbetaling']],
    costs: {
      fertiliser: fertiliser(173),
      seed: [['Udsæd', 160, 'kg/ha', 'rate:Udsæd:10']],
      cropProtection: [
        ['Ukrudt', 1, 'gange', 'rate:Ukrudt:10'],
        ['Sygdom', 1, 'gange', 'rate:Sygdom:10'],
        ['Skadedyr', 1, 'gange', 'rate:Skadedyr:10'],
        ['Vækstregulering', 1, 'gange', 'rate:Vækstregulering:10'],
      ],
      fieldWork: [
        ['Halmpresning', 3900, 'kg/ha', 'rate:Halmpresning'],
        ['Pløjning med pakning', 1, 'gange', 'rate:Pløjning med pakning:10'],
        ['Gødningsspredning', 1, 'gange', 'rate:Gødningsspredning'],
        [
          'Komb. harvning og såning',
          1,
          'gange',
          'rate:Komb. harvning og såning:10',
        ],
        ['Sprøjtning', 4, 'gange', 'rate:Sprøjtning'],
        ['Mejetærskning', 1, 'gange', 'rate:Mejetærskning:10'],
        ['Hjemkørsel, korn', 1, 'gange', 'rate:Hjemkørsel, korn:10'],
        ['Hjemkørsel, halm', 1, 'gange', 'rate:Hjemkørsel, halm:10'],
        ['Øvrige opgaver m.v.', 1, 'gange', 'rate:Øvrige opgaver m.v.'],
      ],
      drying: [['Tørring, korn', 8100, 'kg/ha', 'rate:Tørring, korn']],
    },
  },
  {
    cropCode: 11,
    cropName: 'Vinterhvede',
    precedingCropValueKgNHa: 0,
    revenue: [
      ['Udbytte', 84, 'hkg/ha', 'sale:11'],
      ['Halm', 4800, 'kg/ha', 'straw:11'],
    ],
    subsidies: [['Grundbetaling', 1, 'ha', 'subsidy:Grundbetaling']],
    costs: {
      fertiliser: fertiliser(206),
      seed: [['Udsæd', 150, 'kg/ha', 'rate:Udsæd']],
      cropProtection: [
        ['Ukrudt', 1, 'gange', 'rate:Ukrudt:11'],
        ['Sygdom', 1, 'gange', 'rate:Sygdom:11'],
        ['Skadedyr', 1, 'gange', 'rate:Skadedyr:11'],
        ['Vækstregulering', 1, 'gange', 'rate:Vækstregulering:11'],
      ],
      fieldWork: [
        ['Halmpresning', 4800, 'kg/ha', 'rate:Halmpresning'],
        ['Pløjning med pakning', 1, 'gange', 'rate:Pløjning med pakning:11'],
        ['Gødningsspredning', 2, 'gange', 'rate:Gødningsspredning'],
        [
          'Komb. harvning og såning',
          1,
          'gange',
          'rate:Komb. harvning og såning:11',
        ],
        ['Sprøjtning', 5, 'gange', 'rate:Sprøjtning'],
        ['Mejetærskning', 1, 'gange', 'rate:Mejetærskning:11'],
        ['Hjemkørsel, korn', 1, 'gange', 'rate:Hjemkørsel, korn:11'],
        ['Hjemkørsel, halm', 1, 'gange', 'rate:Hjemkørsel, halm:11'],
        ['Øvrige opgaver m.v.', 1, 'gange', 'rate:Øvrige opgaver m.v.'],
      ],
      drying: [['Tørring, korn', 9900, 'kg/ha', 'rate:Tørring, korn']],
    },
  },
  {
    cropCode: 22,
    cropName: 'Vinterraps',
    precedingCropValueKgNHa: 18,
    revenue: [['Udbytte', 42, 'hkg/ha', 'sale:22']],
    subsidies: [['Grundbetaling', 1, 'ha', 'subsidy:Grundbetaling']],
    costs: {
      fertiliser: fertiliser(177),
      seed: [['Udsæd', 0.25, 'enheder/ha', 'rate:Udsæd:22']],
      cropProtection: [
        ['Ukrudt', 1, 'gange', 'rate:Ukrudt:22'],
        ['Sygdom', 1, 'gange', 'rate:Sygdom:22'],
        ['Skadedyr', 1, 'gange', 'rate:Skadedyr:22'],
        ['Vækstregulering', 1, 'gange', 'rate:Vækstregulering:22'],
        ['Analyser', 1, 'gange', 'rate:Analyser'],
      ],
      fieldWork: [
        ['Rensning', 4400, 'kg/ha', 'rate:Rensning'],
        ['Pløjning med pakning', 1, 'gange', 'rate:Pløjning med pakning:22'],
        ['Gødningsspredning', 3, 'gange', 'rate:Gødningsspredning'],
        [
          'Komb. harvning og såning',
          1,
          'gange',
          'rate:Komb. harvning og såning:22',
        ],
        ['Sprøjtning', 7, 'gange', 'rate:Sprøjtning'],
        ['Mejetærskning', 1, 'gange', 'rate:Mejetærskning:22'],
        ['Hjemkørsel, raps', 1, 'gange', 'rate:Hjemkørsel, raps'],
        ['Øvrige opgaver m.v.', 1, 'gange', 'rate:Øvrige opgaver m.v.'],
      ],
      drying: [['Tørring, raps', 4400, 'kg/ha', 'rate:Tørring, raps']],
    },
  },
  {
    cropCode: 30,
    cropName: 'Ærter',
    precedingCropValueKgNHa: 18,
    revenue: [['Udbytte', 48, 'hkg/ha', 'sale:30']],
    subsidies: [['Grundbetaling', 1, 'ha', 'subsidy:Grundbetaling']],
    costs: {
      fertiliser: [],
      seed: [['Udsæd', 200, 'kg/ha', 'rate:Udsæd:30']],
      cropProtection: [
        ['Ukrudt', 1, 'gange', 'rate:Ukrudt:30'],
        ['Sygdom', 1, 'gange', 'rate:Sygdom:30'],
        ['Skadedyr', 1, 'gange', 'rate:Skadedyr:30'],
      ],
      fieldWork: [
        ['Pløjning med pakning', 1, 'gange', 'rate:Pløjning med pakning'],
        ['Gødningsspredning', 1, 'gange', 'rate:Gødningsspredning'],
        ['Såbedsharvning', 1, 'gange', 'rate:Såbedsharvning'],
        [
          'Komb. harvning og såning',
          1,
          'gange',
          'rate:Komb. harvning og såning',
        ],
        ['Tromling', 1, 'gange', 'rate:Tromling:30'],
        ['Sprøjtning', 2, 'gange', 'rate:Sprøjtning'],
        ['Mejetærskning', 1, 'gange', 'rate:Mejetærskning:30'],
        ['Hjemkørsel, ærter', 1, 'gange', 'rate:Hjemkørsel, ærter'],
        ['Øvrige opgaver m.v.', 1, 'gange', 'rate:Øvrige opgaver m.v.'],
      ],
      drying: [['Tørring, ærter', 4700, 'kg/ha', 'rate:Tørring, ærter']],
    },
  },
  {
    cropCode: 151,
    cropName: 'Kartofler, stivelses-',
    precedingCropValueKgNHa: 0,
    revenue: [['Udbytte', 488, 'hkg/ha', 'sale:151']],
    subsidies: [
      ['Grundbetaling', 1, 'ha', 'subsidy:Grundbetaling'],
      ['Støtte til stivelseskartofler', 1, 'ha', 'subsidy:Stivelseskartofler'],
    ],
    costs: {
      fertiliser: fertiliser(179),
      seed: [
        ['Læggekartofler indkøbt', 460, 'kg/ha', 'rate:Læggekartofler indkøbt'],
        [
          'Læggekartofler egen avl',
          1840,
          'kg/ha',
          'rate:Læggekartofler egen avl',
        ],
      ],
      cropProtection: [
        ['Ukrudt', 1, 'gange', 'rate:Ukrudt'],
        ['Sygdom', 1, 'gange', 'rate:Sygdom:151'],
        ['Skadedyr', 1, 'gange', 'rate:Skadedyr:151'],
        ['Bejdsning v. lægning', 1, 'gange', 'rate:Bejdsning v. lægning:151'],
      ],
      fieldWork: [
        ['Fragt', 58800, 'kg/ha', 'rate:Fragt'],
        ['Pløjning med pakning', 1, 'gange', 'rate:Pløjning med pakning'],
        ['Efterharvning', 1, 'gange', 'rate:Efterharvning'],
        ['Gødningsspredning', 1, 'gange', 'rate:Gødningsspredning'],
        ['Stenstrenglægning', 1, 'gange', 'rate:Stenstrenglægning'],
        [
          'Lægning m. gødn. placering',
          1,
          'gange',
          'rate:Lægning m. gødn. placering',
        ],
        ['Sprøjtning', 16, 'gange', 'rate:Sprøjtning:151'],
        ['Optagning', 1, 'gange', 'rate:Optagning:151'],
        ['Øvrige opgaver m.v.', 1, 'gange', 'rate:Øvrige opgaver m.v.'],
      ],
      drying: [['Opbevaring i kule', 1, 'gange', 'rate:Opbevaring i kule']],
    },
  },
]

const toLine = ([
  label,
  quantity,
  quantityUnit,
  priceId,
]: LineRow): EconomicsLine => ({
  id: label,
  label,
  quantity,
  quantityUnit,
  priceId,
})

const toPrice =
  (source: string) =>
  ([id, label, unit, valueDkk]: PriceRow) => ({
    id,
    label,
    unit,
    valueDkk,
    source,
  })

export const EXAMPLE_ECONOMICS: EconomicsAssumptions = {
  prices: [
    ...SEGES_PRICES.map(toPrice(STANDARD_SOURCE)),
    ...FERTILISER_PRICES.map(toPrice(PRICE_LIST)),
    ...SUBSIDY_PRICES.map(toPrice(PRICE_LIST)),
  ],
  crops: CROPS.map((crop) => ({
    ...crop,
    revenue: crop.revenue.map(toLine),
    subsidies: crop.subsidies.map(toLine),
    costs: Object.fromEntries(
      COST_CATEGORIES.map(({ id }) => [id, crop.costs[id].map(toLine)]),
    ) as CropEconomics['costs'],
  })),
}
