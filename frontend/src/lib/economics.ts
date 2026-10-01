import { parseDecimalInput } from '@/lib/number-input'

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
}

export type CropTotals = {
  revenueDkkHa: number
  subsidyDkkHa: number
  costsDkkHa: Record<CostCategory, number>
  totalCostsDkkHa: number
}

export type EconomicsInput = { value: number } | { error: string }

export const NO_OVERRIDES: EconomicsOverrides = { prices: {}, quantities: {} }

const quantityKey = (crop: CropEconomics, lineId: string) =>
  `${crop.cropCode}/${lineId}`

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

export const lineQuantity = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  line: EconomicsLine,
): number => overrides.quantities[quantityKey(crop, line.id)] ?? line.quantity

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
  return {
    revenueDkkHa: sumLines(assumptions, overrides, crop, crop.revenue),
    subsidyDkkHa: sumLines(assumptions, overrides, crop, crop.subsidies),
    costsDkkHa,
    totalCostsDkkHa: COST_CATEGORIES.reduce(
      (total, category) => total + costsDkkHa[category.id],
      0,
    ),
  }
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

export const isPriceCustomised = (
  overrides: EconomicsOverrides,
  priceId: string,
): boolean => overrides.prices[priceId] !== undefined

export const isQuantityCustomised = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
  lineId: string,
): boolean => overrides.quantities[quantityKey(crop, lineId)] !== undefined

export const isCropCustomised = (
  overrides: EconomicsOverrides,
  crop: CropEconomics,
): boolean =>
  cropLines(crop).some(
    (line) =>
      isPriceCustomised(overrides, line.priceId) ||
      isQuantityCustomised(overrides, crop, line.id),
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

export const parseEconomicsInput = (text: string): EconomicsInput => {
  const value = parseDecimalInput(text)
  if (value === null || Number.isNaN(value)) return { error: 'Skriv et tal.' }
  if (value < 0) return { error: 'Tallet kan ikke være negativt.' }
  return { value }
}

export const economicsInputText = (value: number): string =>
  String(value).replace('.', ',')

const economicsNumberFormat = new Intl.NumberFormat('da-DK', {
  maximumFractionDigits: 2,
})

export const formatEconomicsNumber = (value: number): string =>
  economicsNumberFormat.format(value)

export const quantityUnitLabel = (unit: string, quantity: number): string =>
  unit === 'gange' && quantity === 1 ? 'gang' : unit
