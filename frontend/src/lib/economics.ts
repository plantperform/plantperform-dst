import type { FertiliserSettings } from '@/api/types'
import { formatWholeNumber } from '@/lib/field-domain'

export type CostCategory =
  | 'fertiliser'
  | 'seed'
  | 'cropProtection'
  | 'fieldWork'
  | 'drying'

export const COST_CATEGORIES: readonly { id: CostCategory; label: string }[] = [
  { id: 'fertiliser', label: 'Gødning' },
  { id: 'seed', label: 'Udsæd' },
  { id: 'cropProtection', label: 'Planteværn' },
  { id: 'fieldWork', label: 'Markarbejde' },
  { id: 'drying', label: 'Tørring/lagring' },
]

export type UnitPrice = {
  id: string
  label: string
  unit: string
  valueDkk: number
  source: string
}

export type EconomicsLine = {
  id: string
  label: string
  quantity: number
  quantityUnit: string
  priceId: string
}

export type CropEconomics = {
  cropCode: number
  cropName: string
  precedingCropValueKgNHa: number
  revenue: EconomicsLine[]
  subsidies: EconomicsLine[]
  costs: Record<CostCategory, EconomicsLine[]>
}

export type EconomicsAssumptions = {
  prices: UnitPrice[]
  crops: CropEconomics[]
}

export type EconomicsOverrides = {
  prices: Readonly<Record<string, number>>
  quantities: Readonly<Record<string, number>>
  yieldPct: Readonly<Record<string, number>>
}

export type OverridesChange = (
  current: EconomicsOverrides,
) => EconomicsOverrides

export type CropTotals = {
  revenueDkkHa: number
  subsidyDkkHa: number
  costsDkkHa: Record<CostCategory, number>
  totalCostsDkkHa: number
  dbDkkHa: number
}

export type EconomicsGroupId = 'revenue' | 'subsidy' | CostCategory

export type EconomicsInput = { value: number } | { error: string }

export const NO_OVERRIDES: EconomicsOverrides = {
  prices: {},
  quantities: {},
  yieldPct: {},
}

const sameValues = (
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
) => {
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  )
}

export const sameOverrides = (
  left: EconomicsOverrides,
  right: EconomicsOverrides,
): boolean =>
  sameValues(left.prices, right.prices) &&
  sameValues(left.quantities, right.quantities) &&
  sameValues(left.yieldPct, right.yieldPct)

export const YIELD_ADJUSTMENT_ID = 'yieldPct'

const quantityKey = (crop: CropEconomics, lineId: string) =>
  `${crop.cropCode}/${lineId}`

const cropKey = (crop: CropEconomics) => String(crop.cropCode)

const isRevenueLine = (crop: CropEconomics, lineId: string) =>
  crop.revenue.some((line) => line.id === lineId)

const withoutKey = (record: Readonly<Record<string, number>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key))

const groupedLines = (
  crop: CropEconomics,
): { group: EconomicsGroupId; line: EconomicsLine }[] => [
  ...crop.revenue.map((line) => ({ group: 'revenue' as const, line })),
  ...crop.subsidies.map((line) => ({ group: 'subsidy' as const, line })),
  ...COST_CATEGORIES.flatMap((category) =>
    crop.costs[category.id].map((line) => ({ group: category.id, line })),
  ),
]

const cropLines = (crop: CropEconomics): EconomicsLine[] =>
  groupedLines(crop).map(({ line }) => line)

export const saleLine = (crop: CropEconomics): EconomicsLine | undefined =>
  crop.revenue[0]

export const findPrice = (
  assumptions: EconomicsAssumptions,
  priceId: string,
): UnitPrice | undefined =>
  assumptions.prices.find((price) => price.id === priceId)

export const priceValue = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  priceId: string,
): number =>
  overrides.prices[priceId] ?? findPrice(assumptions, priceId)?.valueDkk ?? 0

export const cropYieldPct = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): number => overrides.yieldPct[cropKey(crop)] ?? 0

export const lineQuantity = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
): number =>
  isRevenueLine(crop, line.id)
    ? line.quantity * (1 + cropYieldPct(overrides, crop) / 100)
    : (overrides.quantities[quantityKey(crop, line.id)] ?? line.quantity)

export const lineAmountDkkHa = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
): number =>
  lineQuantity(overrides, crop, line) *
  priceValue(assumptions, overrides, line.priceId)

const sumLines = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  lines: EconomicsLine[],
) =>
  lines.reduce(
    (total, line) =>
      total + lineAmountDkkHa(assumptions, overrides, crop, line),
    0,
  )

export const cropTotals = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): CropTotals => {
  const costsDkkHa = Object.fromEntries(
    COST_CATEGORIES.map((category) => [
      category.id,
      sumLines(assumptions, overrides, crop, crop.costs[category.id]),
    ]),
  ) as Record<CostCategory, number>
  const revenueDkkHa = sumLines(assumptions, overrides, crop, crop.revenue)
  const subsidyDkkHa = sumLines(assumptions, overrides, crop, crop.subsidies)
  const totalCostsDkkHa = COST_CATEGORIES.reduce(
    (total, category) => total + costsDkkHa[category.id],
    0,
  )
  return {
    revenueDkkHa,
    subsidyDkkHa,
    costsDkkHa,
    totalCostsDkkHa,
    dbDkkHa: revenueDkkHa + subsidyDkkHa - totalCostsDkkHa,
  }
}

const wholeDbDkkHa = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): number => Math.round(cropTotals(assumptions, overrides, crop).dbDkkHa)

export const cropDbChange = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): number =>
  wholeDbDkkHa(assumptions, overrides, crop) -
  wholeDbDkkHa(assumptions, NO_OVERRIDES, crop)

export type CropDbEffect = {
  cropCode: number
  cropName: string
  dbDkkHa: number
  deltaDkkHa: number
}

export const profileDbEffect = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
): CropDbEffect[] =>
  assumptions.crops.map((crop) => ({
    cropCode: crop.cropCode,
    cropName: crop.cropName,
    dbDkkHa: wholeDbDkkHa(assumptions, overrides, crop),
    deltaDkkHa: cropDbChange(assumptions, overrides, crop),
  }))

export type DbDeltaScale = {
  down: number
  up: number
}

export const dbDeltaScale = (effects: CropDbEffect[]): DbDeltaScale => ({
  down: Math.max(0, ...effects.map((effect) => -effect.deltaDkkHa)),
  up: Math.max(0, ...effects.map((effect) => effect.deltaDkkHa)),
})

export const dbDeltaBar = (
  deltaDkkHa: number,
  scale: DbDeltaScale,
): { axis: number; width: number } => {
  const span = scale.down + scale.up
  return span === 0
    ? { axis: 0, width: 0 }
    : { axis: scale.down / span, width: Math.abs(deltaDkkHa) / span }
}

export const lineGroupId = (
  crop: CropEconomics,
  lineId: string,
): EconomicsGroupId | null =>
  lineId === YIELD_ADJUSTMENT_ID
    ? 'revenue'
    : (groupedLines(crop).find(({ line }) => line.id === lineId)?.group ?? null)

export const cropSources = (
  assumptions: EconomicsAssumptions,
  crop: CropEconomics,
): string[] => [
  ...new Set(
    cropLines(crop)
      .map((line) => findPrice(assumptions, line.priceId)?.source)
      .filter((source): source is string => source !== undefined),
  ),
]

export const withPriceOverride = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  priceId: string,
  value: number | null,
): EconomicsOverrides => {
  const rest = withoutKey(overrides.prices, priceId)
  const isStandard =
    value === null || value === findPrice(assumptions, priceId)?.valueDkk
  return {
    ...overrides,
    prices: isStandard ? rest : { ...rest, [priceId]: value },
  }
}

export const withQuantityOverride = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  lineId: string,
  value: number | null,
): EconomicsOverrides => {
  const key = quantityKey(crop, lineId)
  const rest = withoutKey(overrides.quantities, key)
  const standard = cropLines(crop).find((line) => line.id === lineId)?.quantity
  const isStandard = value === null || value === standard
  return {
    ...overrides,
    quantities: isStandard ? rest : { ...rest, [key]: value },
  }
}

export const withYieldPct = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  value: number | null,
): EconomicsOverrides => {
  const key = cropKey(crop)
  const rest = withoutKey(overrides.yieldPct, key)
  const isStandard = value === null || value === 0
  return {
    ...overrides,
    yieldPct: isStandard ? rest : { ...rest, [key]: value },
  }
}

export const isPriceCustomised = (
  overrides: EconomicsOverrides,
  priceId: string,
): boolean => overrides.prices[priceId] !== undefined

export const isQuantityCustomised = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  lineId: string,
): boolean => overrides.quantities[quantityKey(crop, lineId)] !== undefined

export const isYieldCustomised = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): boolean => overrides.yieldPct[cropKey(crop)] !== undefined

export const isLineCustomised = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
): boolean =>
  isPriceCustomised(overrides, line.priceId) ||
  isQuantityCustomised(overrides, crop, line.id)

export const isCropCustomised = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): boolean =>
  isYieldCustomised(overrides, crop) ||
  cropLines(crop).some((line) => isLineCustomised(overrides, crop, line))

export type BreakdownRow =
  | { kind: 'yield' }
  | { kind: 'salePrice' }
  | { kind: 'revenue' }
  | { kind: 'subsidy' }
  | { kind: 'cost'; category: string; treatment: string }

export type BreakdownTarget = Pick<EconomicsLine, 'id'>

export const customisedBreakdownLine = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  cropCode: number,
  row: BreakdownRow,
): BreakdownTarget | null => {
  const crop = assumptions.crops.find((entry) => entry.cropCode === cropCode)
  if (!crop) return null
  const customised = (line: EconomicsLine) =>
    isLineCustomised(overrides, crop, line)
  const yieldLine = saleLine(crop)
  switch (row.kind) {
    case 'yield':
      return isYieldCustomised(overrides, crop)
        ? { id: YIELD_ADJUSTMENT_ID }
        : null
    case 'salePrice':
      return yieldLine && isPriceCustomised(overrides, yieldLine.priceId)
        ? yieldLine
        : null
    case 'revenue':
      return (
        crop.revenue.find((line) => line !== yieldLine && customised(line)) ??
        null
      )
    case 'subsidy':
      return crop.subsidies.find(customised) ?? null
    case 'cost': {
      const category = COST_CATEGORIES.find(
        (entry) => entry.label === row.category,
      )
      const treatment = row.treatment.replace(/ \(\d+ kg\/ha\)$/, '')
      const line = category
        ? crop.costs[category.id].find((entry) => entry.label === treatment)
        : undefined
      return line && customised(line) ? line : null
    }
  }
}

export const withoutCropChanges = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): EconomicsOverrides =>
  cropLines(crop).reduce(
    (current, line) =>
      withPriceOverride(
        assumptions,
        withQuantityOverride(current, crop, line.id, null),
        line.priceId,
        null,
      ),
    withYieldPct(overrides, crop, null),
  )

const GROUPED_THOUSANDS = /^[+-]?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/

const parseEconomicsNumber = (text: string): number => {
  const compact = text.replace(/\s/g, '').replace(/−/g, '-')
  const plain = (
    GROUPED_THOUSANDS.test(compact) ? compact.replace(/\./g, '') : compact
  ).replace(',', '.')
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(plain)
    ? Math.round(Number(plain) * 100) / 100
    : Number.NaN
}

export const parseEconomicsInput = (text: string): EconomicsInput => {
  const value = parseEconomicsNumber(text)
  if (!Number.isFinite(value)) return { error: 'Skriv et tal.' }
  if (value < 0) return { error: 'Tallet kan ikke være negativt.' }
  return { value }
}

export const parseYieldPctInput = (text: string): EconomicsInput => {
  const value = parseEconomicsNumber(text)
  if (!Number.isFinite(value)) return { error: 'Skriv et tal.' }
  if (value <= -100) return { error: 'Skriv et tal over −100.' }
  return { value }
}

const economicsNumberFormat = new Intl.NumberFormat('da-DK', {
  maximumFractionDigits: 2,
})

export const formatEconomicsNumber = (value: number): string =>
  economicsNumberFormat.format(value)

export const formatYieldPct = (value: number): string => {
  if (value > 0) return `+${formatEconomicsNumber(value)}`
  if (value < 0) return `−${formatEconomicsNumber(-value)}`
  return '0'
}

export const YIELD_PCT_STEP = 5

export const stepYieldPct = (current: number, direction: 1 | -1): number => {
  const next = current + direction * YIELD_PCT_STEP
  return next > -100 ? next : current
}

export const formatDbDkk = (value: number): string => {
  const rounded = Math.round(value)
  return rounded < 0
    ? `−${formatWholeNumber(-rounded)}`
    : formatWholeNumber(rounded || 0)
}

export const formatSignedDkk = (value: number): string => {
  const rounded = Math.round(value)
  return rounded > 0 ? `+${formatDbDkk(rounded)}` : formatDbDkk(rounded)
}

export const nameListFormat = new Intl.ListFormat('da-DK', {
  style: 'long',
  type: 'conjunction',
})

export const formatNameList = (names: string[]): string =>
  nameListFormat.format(names)

export const quantityUnitLabel = (unit: string, quantity: number): string =>
  unit === 'gange' && quantity === 1 ? 'gang' : unit

export const priceCrops = (
  assumptions: EconomicsAssumptions,
  priceId: string,
): CropEconomics[] =>
  assumptions.crops.filter((crop) =>
    cropLines(crop).some((line) => line.priceId === priceId),
  )

export const categoryPrices = (
  assumptions: EconomicsAssumptions,
  category: CostCategory,
): UnitPrice[] => {
  const priceIds = new Set(
    assumptions.crops.flatMap((crop) =>
      crop.costs[category].map((line) => line.priceId),
    ),
  )
  return assumptions.prices.filter((price) => priceIds.has(price.id))
}

export const sharedPriceEffect = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  priceId: string,
  value: number,
): { cropName: string; deltaDkkHa: number }[] => {
  const changed = withPriceOverride(assumptions, overrides, priceId, value)
  return priceCrops(assumptions, priceId).map((crop) => ({
    cropName: crop.cropName,
    deltaDkkHa:
      wholeDbDkkHa(assumptions, changed, crop) -
      wholeDbDkkHa(assumptions, overrides, crop),
  }))
}

const STRAW_LINE_LABEL = 'Halm'

export const yieldHint = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): string => {
  const grain = saleLine(crop)
  if (!grain) return ''
  const straw = crop.revenue.find((line) => line.label === STRAW_LINE_LABEL)
  const amount = (line: EconomicsLine) =>
    `${formatEconomicsNumber(lineQuantity(overrides, crop, line))} ${line.quantityUnit.replace('/ha', '')}`
  const quantities = straw
    ? `${amount(grain)} kerne og ${amount(straw)} halm`
    : amount(grain)
  const pct = cropYieldPct(overrides, crop)
  return pct === 0
    ? `Normen er ${quantities} pr. ha. Procenten ændrer ${straw ? 'begge' : 'mængden'}, men ikke omkostningerne.`
    : `${formatYieldPct(pct)} % giver ${quantities} pr. ha. Omkostningerne ændrer sig ikke.`
}

export type ProfileChange = {
  key: string
  kind: 'yield' | 'price' | 'quantity'
  label: string
  cropNames: string[]
  from: string
  to: string
  guideStep: 1 | 2 | 3 | 4 | null
}

const COST_GUIDE_STEPS: Partial<Record<EconomicsGroupId, 2 | 4>> = {
  fertiliser: 2,
  fieldWork: 4,
}

export const YIELD_ADJUSTMENT_LABEL = 'Udbytte i forhold til normen'

const yieldChange = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): ProfileChange => ({
  key: `yield:${cropKey(crop)}`,
  kind: 'yield',
  label: YIELD_ADJUSTMENT_LABEL,
  cropNames: [crop.cropName],
  from: '0 %',
  to: `${formatYieldPct(cropYieldPct(overrides, crop))} %`,
  guideStep: 3,
})

const priceChange = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  group: EconomicsGroupId,
  line: EconomicsLine,
): ProfileChange => {
  const price = findPrice(assumptions, line.priceId)
  const withUnit = (value: number) =>
    `${formatEconomicsNumber(value)} ${price?.unit ?? ''}`.trim()
  return {
    key: `price:${line.priceId}`,
    kind: 'price',
    label: price?.label ?? line.label,
    cropNames: priceCrops(assumptions, line.priceId).map(
      (entry) => entry.cropName,
    ),
    from: withUnit(price?.valueDkk ?? 0),
    to: withUnit(priceValue(assumptions, overrides, line.priceId)),
    guideStep: line === saleLine(crop) ? 1 : (COST_GUIDE_STEPS[group] ?? null),
  }
}

const quantityChange = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
): ProfileChange => {
  const withUnit = (value: number) =>
    `${formatEconomicsNumber(value)} ${quantityUnitLabel(line.quantityUnit, value)}`
  return {
    key: `quantity:${quantityKey(crop, line.id)}`,
    kind: 'quantity',
    label: `${line.label}, mængde`,
    cropNames: [crop.cropName],
    from: withUnit(line.quantity),
    to: withUnit(lineQuantity(overrides, crop, line)),
    guideStep: null,
  }
}

export const profileChanges = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
): ProfileChange[] => {
  const yields = assumptions.crops
    .filter((crop) => isYieldCustomised(overrides, crop))
    .map((crop) => yieldChange(overrides, crop))
  const listedPrices = new Set<string>()
  const lines = assumptions.crops.flatMap((crop) =>
    groupedLines(crop).flatMap(({ group, line }) => {
      const changes: ProfileChange[] = []
      if (
        isPriceCustomised(overrides, line.priceId) &&
        !listedPrices.has(line.priceId)
      ) {
        listedPrices.add(line.priceId)
        changes.push(priceChange(assumptions, overrides, crop, group, line))
      }
      if (isQuantityCustomised(overrides, crop, line.id)) {
        changes.push(quantityChange(overrides, crop, line))
      }
      return changes
    }),
  )
  return [...yields, ...lines]
}

export type ProfileChangeComparison = {
  key: string
  label: string
  cropNames: string[]
  cells: { value: string; changed: boolean }[]
}

export const compareProfileChanges = (
  columns: ProfileChange[][],
): ProfileChangeComparison[] => {
  const rows = new Map<string, ProfileChange>()
  for (const change of columns.flat()) {
    if (!rows.has(change.key)) rows.set(change.key, change)
  }
  return [...rows.values()].map((row) => ({
    key: row.key,
    label: row.label,
    cropNames: row.cropNames,
    cells: columns.map((changes) => {
      const own = changes.find((change) => change.key === row.key)
      return { value: own?.to ?? row.from, changed: own !== undefined }
    }),
  }))
}

const formatCount = (count: number, one: string, several: string): string =>
  `${count} ${count === 1 ? one : several}`

export const formatChangeCount = (count: number): string =>
  count === 0 ? 'Ingen ændringer' : formatCount(count, 'ændring', 'ændringer')

export const profileChangesTitle = (count: number): string =>
  `${formatChangeCount(count)} i forhold til Standard`

export const formatCropCount = (count: number): string =>
  formatCount(count, 'afgrøde', 'afgrøder')

export const describePriceCrops = (
  assumptions: EconomicsAssumptions,
  priceId: string,
): string => {
  const crops = priceCrops(assumptions, priceId)
  return crops.length === assumptions.crops.length
    ? `Alle ${formatCropCount(crops.length)}`
    : formatNameList(crops.map((crop) => crop.cropName))
}

export const describeProfileChanges = (changes: ProfileChange[]): string => {
  const ofKind = (kind: ProfileChange['kind']) =>
    changes.filter((change) => change.kind === kind)
  const yields = ofKind('yield')
  const prices = ofKind('price').length
  const quantities = ofKind('quantity').length
  const parts = [
    yields.length === 1 ? `Udbytte for ${yields[0].cropNames[0]}` : null,
    yields.length > 1 ? `Udbytte for ${formatCropCount(yields.length)}` : null,
    prices > 0 ? formatCount(prices, 'pris', 'priser') : null,
    quantities > 0 ? formatCount(quantities, 'mængde', 'mængder') : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? formatNameList(parts) : 'Samme tal som Standard'
}

const OVERRIDE_FIELD = {
  yield: 'yieldPct',
  price: 'prices',
  quantity: 'quantities',
} as const

export const withoutProfileChange = (
  overrides: EconomicsOverrides,
  change: ProfileChange,
): EconomicsOverrides => {
  const field = OVERRIDE_FIELD[change.kind]
  return {
    ...overrides,
    [field]: withoutKey(
      overrides[field],
      change.key.slice(change.kind.length + 1),
    ),
  }
}

export const FERTILISER_PRICE_IDS = {
  mineralN: 'rate:Handelsgødning, kvælstof (N)',
  mineralSpreading: 'rate:Handelsgødning, udbringning',
  manureN: 'rate:Husdyrgødning, kvælstof (N)',
  manureSpreading: 'rate:Gylleudbringning, slæbeslanger',
} as const

export type FertiliserPlan = Pick<
  FertiliserSettings,
  'orgMineralN' | 'onlyOrganic' | 'nContentKgPerTon'
>

const fertiliserQuantities = (
  nNormKgHa: number,
  { orgMineralN, onlyOrganic, nContentKgPerTon }: FertiliserPlan,
): Record<string, number> => {
  const manureN = Math.min(orgMineralN, nNormKgHa)
  const mineralN = onlyOrganic ? 0 : nNormKgHa - manureN
  return {
    [FERTILISER_PRICE_IDS.mineralN]: mineralN,
    [FERTILISER_PRICE_IDS.mineralSpreading]: mineralN > 0 ? 1 : 0,
    [FERTILISER_PRICE_IDS.manureN]: manureN,
    [FERTILISER_PRICE_IDS.manureSpreading]:
      nContentKgPerTon > 0 ? manureN / nContentKgPerTon : 0,
  }
}

export const withFertiliserPlan = (
  assumptions: EconomicsAssumptions,
  plan: FertiliserPlan,
): EconomicsAssumptions => ({
  ...assumptions,
  crops: assumptions.crops.map((crop) => {
    const nNormKgHa =
      crop.costs.fertiliser.find(
        (line) => line.priceId === FERTILISER_PRICE_IDS.mineralN,
      )?.quantity ?? 0
    const quantities = fertiliserQuantities(nNormKgHa, plan)
    return {
      ...crop,
      costs: {
        ...crop.costs,
        fertiliser: crop.costs.fertiliser.map((line) => ({
          ...line,
          quantity: quantities[line.priceId] ?? line.quantity,
        })),
      },
    }
  }),
})

export const FERTILISER_NOTE =
  'Gødningen er regnet som ren handelsgødning efter kvælstofnormen. I en simulering med husdyrgødning følger mængderne simuleringens gødningsvalg.'
