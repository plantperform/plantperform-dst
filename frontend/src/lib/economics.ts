import type { EconomicsOverrides, FarmingSystem } from '@/api/types'
import { formatWholeNumber } from '@/lib/field-domain'

export type CostCategory =
  | 'fertiliser'
  | 'otherFertilisers'
  | 'seed'
  | 'cropProtection'
  | 'fieldWork'
  | 'drying'

export const COST_CATEGORIES: readonly { id: CostCategory; label: string }[] = [
  { id: 'fertiliser', label: 'Gødning' },
  { id: 'otherFertilisers', label: 'Andre gødningsstoffer' },
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
  source: string | null
}

export type EconomicsLine = {
  id: string
  label: string
  quantity: number
  quantityUnit: string
  quantityId: string | null
  priceId: string
  followsYield: boolean
}

export type CropEconomics = {
  cropCode: number
  cropName: string
  precedingCropValueKgNHa: number
  revenue: EconomicsLine[]
  subsidies: EconomicsLine[]
  costs: Record<CostCategory, EconomicsLine[]>
}

export type SoilVariant = { id: string; value: number }

// The husdyrgødning an økologisk budget without a simulation is fertilised
// with. It covers the whole N-norm, at `nKgPerTon` utilized N per tonne.
export type StandardManure = {
  name: string
  nKgPerTon: number
}

export type EconomicsAssumptions = {
  soilTypeNumber: number | null
  farmingSystem: FarmingSystem
  prices: UnitPrice[]
  // The husdyrgødning prices per tonne, in `prices` on either farming system
  // even when no budget row uses them.
  manureSpreadingPriceId?: string | null
  manurePurchasePriceId?: string | null
  standardManure?: StandardManure | null
  crops: CropEconomics[]
  soilVariants: Readonly<Record<string, readonly SoilVariant[]>>
}

export type { EconomicsOverrides }

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

const cropKey = (crop: CropEconomics) => String(crop.cropCode)

const withoutKeys = (
  record: Readonly<Record<string, number>>,
  keys: readonly string[],
) =>
  Object.fromEntries(
    Object.entries(record).filter(([entry]) => !keys.includes(entry)),
  )

const soilVariantsOf = (
  assumptions: EconomicsAssumptions,
  id: string,
  standard: number,
): readonly SoilVariant[] =>
  assumptions.soilVariants[id] ?? [{ id, value: standard }]

const variantIds = (assumptions: EconomicsAssumptions, id: string): string[] =>
  soilVariantsOf(assumptions, id, 0).map((variant) => variant.id)

const withValue = (
  record: Readonly<Record<string, number>>,
  variants: readonly SoilVariant[],
  value: number | null,
): Record<string, number> => {
  const rest = withoutKeys(
    record,
    variants.map((variant) => variant.id),
  )
  if (value === null) return rest
  return {
    ...rest,
    ...Object.fromEntries(
      variants
        .filter((variant) => variant.value !== value)
        .map((variant) => [variant.id, value]),
    ),
  }
}

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

const findLine = (crop: CropEconomics, lineId: string) =>
  cropLines(crop).find((line) => line.id === lineId)

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

const yieldFactor = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
): number => (line.followsYield ? 1 + cropYieldPct(overrides, crop) / 100 : 1)

export const lineQuantity = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
): number =>
  ((line.quantityId === null
    ? undefined
    : overrides.quantities[line.quantityId]) ?? line.quantity) *
  yieldFactor(overrides, crop, line)

export const standardLineQuantity = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
): number => line.quantity * yieldFactor(overrides, crop, line)

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

export const dbDeltaScale = (deltas: number[]): DbDeltaScale => ({
  down: Math.max(0, ...deltas.map((delta) => -delta)),
  up: Math.max(0, ...deltas),
})

export const dbDeltaBar = (
  delta: number,
  scale: DbDeltaScale,
): { axis: number; width: number } => {
  const span = scale.down + scale.up
  return span === 0
    ? { axis: 0, width: 0 }
    : { axis: scale.down / span, width: Math.abs(delta) / span }
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
    cropLines(crop).flatMap(
      (line) => findPrice(assumptions, line.priceId)?.source ?? [],
    ),
  ),
]

export const withPriceOverride = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  priceId: string,
  value: number | null,
): EconomicsOverrides => {
  const standard = findPrice(assumptions, priceId)?.valueDkk ?? 0
  return {
    ...overrides,
    prices: withValue(
      overrides.prices,
      soilVariantsOf(assumptions, priceId, standard),
      value === standard ? null : value,
    ),
  }
}

export const withQuantityOverride = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  lineId: string,
  value: number | null,
): EconomicsOverrides => {
  const line = findLine(crop, lineId)
  if (!line?.quantityId) return overrides
  return {
    ...overrides,
    quantities: withValue(
      overrides.quantities,
      soilVariantsOf(assumptions, line.quantityId, line.quantity),
      value === line.quantity ? null : value,
    ),
  }
}

export const withShownQuantity = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
  shown: number,
): EconomicsOverrides => {
  const quantity = shown / yieldFactor(overrides, crop, line)
  return withQuantityOverride(
    assumptions,
    overrides,
    crop,
    line.id,
    Math.abs(quantity - line.quantity) < 1e-6 ? null : quantity,
  )
}

export const withYieldPct = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  value: number | null,
): EconomicsOverrides => ({
  ...overrides,
  yieldPct: withValue(
    overrides.yieldPct,
    [{ id: cropKey(crop), value: 0 }],
    value,
  ),
})

export const isPriceCustomised = (
  overrides: EconomicsOverrides,
  priceId: string,
): boolean => overrides.prices[priceId] !== undefined

export const isQuantityCustomised = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  lineId: string,
): boolean => {
  const quantityId = findLine(crop, lineId)?.quantityId
  return (
    typeof quantityId === 'string' &&
    overrides.quantities[quantityId] !== undefined
  )
}

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
        withQuantityOverride(assumptions, current, crop, line.id, null),
        line.priceId,
        null,
      ),
    withYieldPct(overrides, crop, null),
  )

const GROUPED_THOUSANDS = /^[+-]?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/

const roundToHundredths = (plain: string): number => {
  const rounded = Math.round(Number(`${plain.replace(/^[+-]/, '')}e2`)) / 100
  return plain.startsWith('-') ? -rounded : rounded
}

const parseEconomicsNumber = (text: string): number => {
  const compact = text.replace(/\s/g, '').replace(/−/g, '-')
  const plain = (
    GROUPED_THOUSANDS.test(compact) ? compact.replace(/\./g, '') : compact
  ).replace(',', '.')
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(plain)
    ? roundToHundredths(plain)
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
): CropEconomics[] => {
  const ids = variantIds(assumptions, priceId)
  return assumptions.crops.filter((crop) =>
    cropLines(crop).some((line) => ids.includes(line.priceId)),
  )
}

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

// Spreading and buying husdyrgødning, per tonne. They are there on either
// farming system, since a simulation that spreads husdyrgødning uses them.
export const manurePrices = (assumptions: EconomicsAssumptions): UnitPrice[] =>
  [assumptions.manureSpreadingPriceId, assumptions.manurePurchasePriceId].flatMap(
    (id) => {
      const price = id ? findPrice(assumptions, id) : undefined
      return price ? [price] : []
    },
  )

export type CropDbDelta = { cropName: string; deltaDkkHa: number }

const dbDeltas = (
  assumptions: EconomicsAssumptions,
  before: EconomicsOverrides,
  after: EconomicsOverrides,
  crops: CropEconomics[],
): CropDbDelta[] =>
  crops.map((crop) => ({
    cropName: crop.cropName,
    deltaDkkHa:
      wholeDbDkkHa(assumptions, after, crop) -
      wholeDbDkkHa(assumptions, before, crop),
  }))

export const sharedPriceEffect = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  priceId: string,
  value: number,
): CropDbDelta[] =>
  dbDeltas(
    assumptions,
    overrides,
    withPriceOverride(assumptions, overrides, priceId, value),
    priceCrops(assumptions, priceId),
  )

export const sharedCustomisedPrices = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): UnitPrice[] =>
  assumptions.prices.filter(
    (price) =>
      isPriceCustomised(overrides, price.id) &&
      cropLines(crop).some((line) => line.priceId === price.id) &&
      priceCrops(assumptions, price.id).length > 1,
  )

export const cropRestoreEffect = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): CropDbDelta[] => {
  const shared = new Set(
    sharedCustomisedPrices(assumptions, overrides, crop).flatMap((price) =>
      variantIds(assumptions, price.id),
    ),
  )
  return dbDeltas(
    assumptions,
    overrides,
    withoutCropChanges(assumptions, overrides, crop),
    assumptions.crops.filter(
      (entry) =>
        entry === crop ||
        cropLines(entry).some((line) => shared.has(line.priceId)),
    ),
  )
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
  const dried = crop.costs.drying.length > 0
  return pct === 0
    ? `Normen er ${quantities} pr. ha. Procenten ændrer ${straw ? 'begge' : 'mængden'}${dried ? ' og tørringen' : ''}, men ikke ${dried ? 'de andre omkostninger' : 'omkostningerne'}.`
    : `${formatYieldPct(pct)} % giver ${quantities} pr. ha. ${dried ? 'Tørringen følger med, de andre omkostninger ændrer sig ikke.' : 'Omkostningerne ændrer sig ikke.'}`
}

export type ProfileChange = {
  key: string
  kind: 'yield' | 'price' | 'quantity'
  label: string
  cropNames: string[]
  // What a price without crop rows applies to, such as the husdyrgødning prices.
  appliesTo?: string
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
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  line: EconomicsLine & { quantityId: string },
): ProfileChange => {
  const withUnit = (value: number) =>
    `${formatEconomicsNumber(value)} ${quantityUnitLabel(line.quantityUnit, value)}`
  const ids = variantIds(assumptions, line.quantityId)
  return {
    key: `quantity:${line.quantityId}`,
    kind: 'quantity',
    label: `${line.label}, mængde`,
    cropNames: assumptions.crops
      .filter((entry) =>
        cropLines(entry).some(
          (candidate) =>
            candidate.quantityId !== null && ids.includes(candidate.quantityId),
        ),
      )
      .map((entry) => entry.cropName),
    from: withUnit(line.quantity),
    to: withUnit(overrides.quantities[line.quantityId] ?? line.quantity),
    guideStep: null,
  }
}

const MANURE_APPLIES_TO = 'Simuleringer med husdyrgødning'

// The husdyrgødning prices belong to no crop row in the standard, so they are
// listed on their own.
const manureChanges = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  listed: ReadonlySet<string>,
): ProfileChange[] =>
  manurePrices(assumptions)
    .filter(
      (price) => isPriceCustomised(overrides, price.id) && !listed.has(price.id),
    )
    .map((price): ProfileChange => {
      const withUnit = (value: number) =>
        `${formatEconomicsNumber(value)} ${price.unit}`
      return {
        key: `price:${price.id}`,
        kind: 'price',
        label: price.label,
        cropNames: [],
        appliesTo: MANURE_APPLIES_TO,
        from: withUnit(price.valueDkk),
        to: withUnit(priceValue(assumptions, overrides, price.id)),
        guideStep: 2,
      }
    })

export const profileChanges = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
): ProfileChange[] => {
  const yields = assumptions.crops
    .filter((crop) => isYieldCustomised(overrides, crop))
    .map((crop) => yieldChange(overrides, crop))
  const listed = new Set<string>()
  const lines = assumptions.crops.flatMap((crop) =>
    groupedLines(crop).flatMap(({ group, line }) => {
      const changes: ProfileChange[] = []
      const { quantityId } = line
      const list = (id: string) => {
        for (const variant of variantIds(assumptions, id)) {
          listed.add(variant)
        }
      }
      if (
        isPriceCustomised(overrides, line.priceId) &&
        !listed.has(line.priceId)
      ) {
        list(line.priceId)
        changes.push(priceChange(assumptions, overrides, crop, group, line))
      }
      if (
        quantityId !== null &&
        overrides.quantities[quantityId] !== undefined &&
        !listed.has(quantityId)
      ) {
        list(quantityId)
        changes.push(
          quantityChange(assumptions, overrides, { ...line, quantityId }),
        )
      }
      return changes
    }),
  )
  return [...yields, ...lines, ...manureChanges(assumptions, overrides, listed)]
}

export type ProfileChangeComparison = {
  key: string
  label: string
  cropNames: string[]
  appliesTo?: string
  cells: { value: string; changed: boolean }[]
}

export type ProfileColumn = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
}

export const compareProfileChanges = (
  columns: ProfileColumn[],
): ProfileChangeComparison[] => {
  const changes = columns.map((column) =>
    profileChanges(column.assumptions, column.overrides),
  )
  const rows = new Map<string, ProfileChange>()
  for (const change of changes.flat()) {
    if (!rows.has(change.key)) rows.set(change.key, change)
  }
  const standards = columns.map(
    (column) =>
      new Map(
        columns
          .flatMap((other) =>
            profileChanges(column.assumptions, other.overrides),
          )
          .map((change) => [change.key, change.from]),
      ),
  )
  return [...rows.values()].map((row) => ({
    key: row.key,
    label: row.label,
    cropNames: row.cropNames,
    appliesTo: row.appliesTo,
    cells: changes.map((own, index) => {
      const change = own.find((entry) => entry.key === row.key)
      return {
        value: change?.to ?? standards[index].get(row.key) ?? '',
        changed: change !== undefined,
      }
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

export const formatCropNames = (names: string[]): string =>
  names.length > 3 ? formatCropCount(names.length) : formatNameList(names)

export const describePriceCrops = (
  assumptions: EconomicsAssumptions,
  priceId: string,
): string => {
  const crops = priceCrops(assumptions, priceId)
  return crops.length === assumptions.crops.length
    ? `Alle ${formatCropCount(crops.length)}`
    : formatCropNames(crops.map((crop) => crop.cropName))
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
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
  change: ProfileChange,
): EconomicsOverrides => {
  const field = OVERRIDE_FIELD[change.kind]
  const key = change.key.slice(change.kind.length + 1)
  return {
    ...overrides,
    [field]: withoutKeys(
      overrides[field],
      change.kind === 'yield' ? [key] : variantIds(assumptions, key),
    ),
  }
}

export const withoutProfileChanges = (
  assumptions: EconomicsAssumptions,
  overrides: EconomicsOverrides,
): EconomicsOverrides =>
  profileChanges(assumptions, overrides).reduce(
    (current, change) => withoutProfileChange(assumptions, current, change),
    overrides,
  )

export const applyOverrideEdits = (
  current: EconomicsOverrides,
  before: EconomicsOverrides,
  after: EconomicsOverrides,
): EconomicsOverrides => {
  const merge = (field: keyof EconomicsOverrides) => {
    const edited = Object.keys({ ...before[field], ...after[field] }).filter(
      (key) => before[field][key] !== after[field][key],
    )
    return {
      ...withoutKeys(current[field], edited),
      ...Object.fromEntries(
        edited.flatMap((key) =>
          after[field][key] === undefined ? [] : [[key, after[field][key]]],
        ),
      ),
    }
  }
  return {
    prices: merge('prices'),
    quantities: merge('quantities'),
    yieldPct: merge('yieldPct'),
  }
}

export const fertiliserNote = ({
  standardManure,
}: Pick<EconomicsAssumptions, 'standardManure'>): string => {
  const source = standardManure
    ? `Gødningen er regnet som ${standardManure.name.toLocaleLowerCase('da-DK')}, der dækker hele kvælstofnormen med ${formatEconomicsNumber(standardManure.nKgPerTon)} kg udnyttet N pr. ton, og med udbringning og køb pr. ton. På en konventionel bedrift er den handelsgødning efter kvælstofnormen.`
    : 'Gødningen er regnet som handelsgødning efter kvælstofnormen. På en økologisk bedrift er den regnet som svinegylle.'
  return `${source} I en simulering følger mængderne simuleringens gødningsvalg. Husdyrgødningens udbringning og købspris regnes pr. ton og gælder, når en simulering bruger husdyrgødning.`
}

export const budgetSoilType = ({
  soilTypeNumber,
}: Pick<EconomicsAssumptions, 'soilTypeNumber'>): string =>
  soilTypeNumber === null ? 'ukendt jordtype' : `JB ${soilTypeNumber}`

export const describeBudgetBasis = (
  assumptions: EconomicsAssumptions,
): string =>
  `${budgetSoilType(assumptions)}, ${assumptions.farmingSystem.toLocaleLowerCase('da-DK')} drift`

export const SOIL_VARIANTS_NOTE =
  'Retter du en pris eller mængde, der afhænger af jordtypen, gælder rettelsen for alle jordtyper.'

export const NO_SOIL_TYPE_NOTE =
  'Bedriftens marker har ingen jordtype, så der er ingen tal at vise.'

export const describeBudgetSoil = (
  assumptions: EconomicsAssumptions,
): string =>
  assumptions.soilTypeNumber === null
    ? NO_SOIL_TYPE_NOTE
    : `Tal i kr/ha for ${assumptions.farmingSystem.toLocaleLowerCase('da-DK')} drift på ${budgetSoilType(assumptions)}, bedriftens mest udbredte jordtype, uden vanding.`
