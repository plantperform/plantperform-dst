import type {
  FieldRecord,
  OptimizationSettings,
  QuotaTrade,
  QuotaTradePrices,
} from '@/api/types'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'

// What the Kvotehandel step edits. A catchment keeps its prices while it is
// switched off or cannot trade, so going back and forth loses nothing; only
// quotaTradesFrom decides what is saved. An empty sell price sells at the buy
// price.
export type QuotaTradeDraft = {
  enabled: boolean
  // One choice for every catchment that trades.
  sameEachYear: boolean
  catchments: Record<
    number,
    { enabled: boolean; buyPrice: string; sellPrice: string }
  >
}

// A new kvotehandel chooses its amount for each year.
export const NO_QUOTA_TRADE_DRAFT: QuotaTradeDraft = {
  enabled: false,
  sameEachYear: false,
  catchments: {},
}

export const quotaTradeDraftFrom = (
  trades: QuotaTrade[] | undefined,
): QuotaTradeDraft =>
  !trades || trades.length === 0
    ? NO_QUOTA_TRADE_DRAFT
    : {
        enabled: true,
        sameEachYear: trades.every((trade) => trade.sameEachYear !== false),
        catchments: Object.fromEntries(
          trades.map((trade) => [
            trade.catchmentId,
            {
              enabled: true,
              buyPrice: String(trade.buyPriceDkkPerKg),
              sellPrice:
                trade.sellPriceDkkPerKg === trade.buyPriceDkkPerKg
                  ? ''
                  : String(trade.sellPriceDkkPerKg),
            },
          ]),
        ),
      }

// Mirrors the backend's untradable_quota_reason. A catchment without a saved
// yearly cap uses its kvote in every year, so it can trade.
export const quotaTradeBlock = (
  catchmentId: number | null,
  fields: FieldRecord[],
  settings: OptimizationSettings,
): string | null => {
  if (catchmentId === null) return 'Marker uden kystvandopland kan ikke handle'
  if (
    !fields.some(
      (field) => field.catchmentId === catchmentId && field.quotaEligible,
    )
  )
    return 'Ingen kvotegivende marker'
  const cap = settings.maxNLoadByCatchment.find(
    (entry) => entry.catchmentId === catchmentId,
  )
  if (cap && ROTATION_CALENDAR_YEARS.some((year) => !(year in cap.maxNLoadByYear)))
    return 'Kræver en grænse i alle år'
  return null
}

// The caps a trade moves, as set under Grænser: one value when every year has
// the same, else the range. undefined when no year has a cap.
export const originalCapRange = (
  catchmentId: number,
  fields: FieldRecord[],
  settings: OptimizationSettings,
): { min: number; max: number } | undefined => {
  const cap = settings.maxNLoadByCatchment.find(
    (entry) => entry.catchmentId === catchmentId,
  )
  const quota = fields
    .filter((field) => field.catchmentId === catchmentId && field.quotaEligible)
    .reduce((sum, field) => sum + field.nLoadQuotaKgN, 0)
  const values = cap
    ? Object.values(cap.maxNLoadByYear)
    : quota > 0
      ? [Math.round(quota)]
      : []
  if (values.length === 0) return undefined
  return { min: Math.min(...values), max: Math.max(...values) }
}

const parsePrice = (price: string) =>
  price.trim() === '' ? NaN : Number(price.replace(',', '.'))

const parsePrices = (entry: {
  buyPrice: string
  sellPrice: string
}): QuotaTradePrices => {
  const buyPriceDkkPerKg = parsePrice(entry.buyPrice)
  return {
    buyPriceDkkPerKg,
    sellPriceDkkPerKg:
      entry.sellPrice.trim() === ''
        ? buyPriceDkkPerKg
        : parsePrice(entry.sellPrice),
  }
}

const tradingCatchments = (
  draft: QuotaTradeDraft,
  settings: OptimizationSettings,
  fields: FieldRecord[],
) =>
  draft.enabled && settings.kind === 'yearly'
    ? Object.entries(draft.catchments)
        .map(([id, entry]) => ({ catchmentId: Number(id), ...entry }))
        .filter(
          (entry) =>
            entry.enabled &&
            quotaTradeBlock(entry.catchmentId, fields, settings) === null,
        )
    : []

// The trades to save: only the yearly optimization trades, and a catchment
// that cannot trade is left out rather than failing the save.
export const quotaTradesFrom = (
  draft: QuotaTradeDraft,
  settings: OptimizationSettings,
  fields: FieldRecord[],
): QuotaTrade[] =>
  tradingCatchments(draft, settings, fields).map((entry) => ({
    catchmentId: entry.catchmentId,
    ...parsePrices(entry),
    sameEachYear: draft.sameEachYear,
  }))

export const quotaTradeError = (
  draft: QuotaTradeDraft,
  settings: OptimizationSettings,
  fields: FieldRecord[],
): string | null => {
  if (!draft.enabled || settings.kind !== 'yearly') return null
  const trading = tradingCatchments(draft, settings, fields)
  if (trading.length === 0)
    return 'Vælg mindst ét kystvandopland, der skal handle kvote.'
  const prices = trading.map(parsePrices)
  if (
    prices.some((price) =>
      [price.buyPriceDkkPerKg, price.sellPriceDkkPerKg].some(
        (value) => !Number.isFinite(value) || value < 0,
      ),
    )
  )
    return 'Priserne skal være tal på mindst 0 kr/kg N.'
  // Mirrors the backend: selling above the buy price would pay for buying
  // and selling the same kvote.
  if (
    prices.some((price) => price.sellPriceDkkPerKg > price.buyPriceDkkPerKg)
  )
    return 'Salgsprisen må ikke være højere end købsprisen.'
  return null
}
