export type CostCategory = 'seed' | 'cropProtection' | 'fieldWork' | 'drying'

export const COST_CATEGORIES: readonly { id: CostCategory; label: string }[] = [
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

export type IncomeShare = {
  id: CostCategory | 'db'
  valueDkkHa: number
  share: number
}

export type EconomicsInput = { value: number } | { error: string }

export const NO_OVERRIDES: EconomicsOverrides = {
  prices: {},
  quantities: {},
  yieldPct: {},
}

export const YIELD_ADJUSTMENT_ID = 'yieldPct'

const quantityKey = (crop: CropEconomics, lineId: string) =>
  `${crop.cropCode}/${lineId}`

const cropKey = (crop: CropEconomics) => String(crop.cropCode)

const isRevenueLine = (crop: CropEconomics, lineId: string) =>
  crop.revenue.some((line) => line.id === lineId)

const withoutKey = (record: Readonly<Record<string, number>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key))

export const cropLines = (crop: CropEconomics): EconomicsLine[] => [
  ...crop.revenue,
  ...crop.subsidies,
  ...COST_CATEGORIES.flatMap((category) => crop.costs[category.id]),
]

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

export const incomeSplit = (totals: CropTotals): IncomeShare[] => {
  const parts = [
    ...COST_CATEGORIES.map((category) => ({
      id: category.id,
      valueDkkHa: totals.costsDkkHa[category.id],
    })),
    { id: 'db' as const, valueDkkHa: Math.max(totals.dbDkkHa, 0) },
  ].filter((part) => part.valueDkkHa > 0)
  const whole = parts.reduce((total, part) => total + part.valueDkkHa, 0)
  return parts.map((part) => ({ ...part, share: part.valueDkkHa / whole }))
}

export const lineGroupId = (
  crop: CropEconomics,
  lineId: string,
): EconomicsGroupId | null => {
  if (lineId === YIELD_ADJUSTMENT_ID || isRevenueLine(crop, lineId)) {
    return 'revenue'
  }
  if (crop.subsidies.some((line) => line.id === lineId)) return 'subsidy'
  return (
    COST_CATEGORIES.find((category) =>
      crop.costs[category.id].some((line) => line.id === lineId),
    )?.id ?? null
  )
}

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

export const searchCrops = (
  crops: CropEconomics[],
  query: string,
): CropEconomics[] => {
  const wanted = query.trim().toLocaleLowerCase('da-DK')
  return wanted === ''
    ? crops
    : crops.filter((crop) =>
        crop.cropName.toLocaleLowerCase('da-DK').includes(wanted),
      )
}

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
): boolean =>
  !isRevenueLine(crop, lineId) &&
  overrides.quantities[quantityKey(crop, lineId)] !== undefined

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

const YIELD_LINE_LABEL = 'Udbytte'

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
  const yieldLine = crop.revenue.find((line) => line.label === YIELD_LINE_LABEL)
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
      const line = category
        ? crop.costs[category.id].find((entry) => entry.label === row.treatment)
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

export const priceUsage = (
  assumptions: EconomicsAssumptions,
): Map<string, number> => {
  const usage = new Map<string, number>()
  for (const crop of assumptions.crops) {
    const priceIds = new Set(cropLines(crop).map((line) => line.priceId))
    for (const priceId of priceIds) {
      usage.set(priceId, (usage.get(priceId) ?? 0) + 1)
    }
  }
  return usage
}

const parseEconomicsNumber = (text: string): number | null => {
  const compact = text.trim().replace(/\s/g, '').replace(/−/g, '-')
  if (compact === '') return null
  const plain = /^[+-]?\d+\.\d{1,2}$/.test(compact)
    ? compact
    : compact.replace(/\./g, '').replace(',', '.')
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(plain) ? Number(plain) : Number.NaN
}

export const parseEconomicsInput = (text: string): EconomicsInput => {
  const value = parseEconomicsNumber(text)
  if (value === null || Number.isNaN(value)) return { error: 'Skriv et tal.' }
  if (value < 0) return { error: 'Tallet kan ikke være negativt.' }
  return { value }
}

export const parseYieldPctInput = (text: string): EconomicsInput => {
  const value = parseEconomicsNumber(text)
  if (value === null || Number.isNaN(value)) return { error: 'Skriv et tal.' }
  if (value <= -100) return { error: 'Skriv et tal over -100.' }
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

const wholeDkkFormat = new Intl.NumberFormat('da-DK', {
  maximumFractionDigits: 0,
})

export const formatDbDkk = (value: number): string => {
  const rounded = Math.round(value)
  return rounded < 0
    ? `−${wholeDkkFormat.format(-rounded)}`
    : wholeDkkFormat.format(rounded)
}

export const formatSignedDkk = (value: number): string => {
  const rounded = Math.round(value)
  return rounded > 0 ? `+${formatDbDkk(rounded)}` : formatDbDkk(rounded)
}

const nameListFormat = new Intl.ListFormat('da-DK', {
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
      cropTotals(assumptions, changed, crop).dbDkkHa -
      cropTotals(assumptions, overrides, crop).dbDkkHa,
  }))
}

const STRAW_LINE_LABEL = 'Halm'

export const yieldHint = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): string => {
  const [grain] = crop.revenue
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
  group: EconomicsGroupId
  shared: boolean
  target: { cropCode: number; lineId: string }
}

const YIELD_ADJUSTMENT_LABEL = 'Udbytte i forhold til normen'

const groupedLines = (
  crop: CropEconomics,
): { group: EconomicsGroupId; line: EconomicsLine }[] => [
  ...crop.revenue.map((line) => ({ group: 'revenue' as const, line })),
  ...crop.subsidies.map((line) => ({ group: 'subsidy' as const, line })),
  ...COST_CATEGORIES.flatMap((category) =>
    crop.costs[category.id].map((line) => ({ group: category.id, line })),
  ),
]

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
  group: 'revenue',
  shared: false,
  target: { cropCode: crop.cropCode, lineId: YIELD_ADJUSTMENT_ID },
})

const priceChange = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  group: EconomicsGroupId,
  line: EconomicsLine,
): ProfileChange => {
  const price = findPrice(assumptions, line.priceId)
  const crops = priceCrops(assumptions, line.priceId)
  const withUnit = (value: number) =>
    `${formatEconomicsNumber(value)} ${price?.unit ?? ''}`.trim()
  return {
    key: `price:${line.priceId}`,
    kind: 'price',
    label: line.label,
    cropNames: crops.map((entry) => entry.cropName),
    from: withUnit(price?.valueDkk ?? 0),
    to: withUnit(priceValue(assumptions, overrides, line.priceId)),
    group,
    shared: crops.length > 1,
    target: { cropCode: crop.cropCode, lineId: line.id },
  }
}

const quantityChange = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  group: EconomicsGroupId,
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
    group,
    shared: false,
    target: { cropCode: crop.cropCode, lineId: line.id },
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
        changes.push(quantityChange(overrides, crop, group, line))
      }
      return changes
    }),
  )
  return [...yields, ...lines]
}

export const profileChangesTitle = (count: number): string => {
  if (count === 0) return 'Ingen ændringer i forhold til Standard'
  return `${count} ${count === 1 ? 'ændring' : 'ændringer'} i forhold til Standard`
}

export const withoutProfileChange = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  change: ProfileChange,
): EconomicsOverrides => {
  const crop = assumptions.crops.find(
    (entry) => entry.cropCode === change.target.cropCode,
  )
  if (!crop) return overrides
  if (change.kind === 'yield') return withYieldPct(overrides, crop, null)
  if (change.kind === 'quantity') {
    return withQuantityOverride(overrides, crop, change.target.lineId, null)
  }
  const line = cropLines(crop).find(
    (entry) => entry.id === change.target.lineId,
  )
  return line
    ? withPriceOverride(assumptions, overrides, line.priceId, null)
    : overrides
}
