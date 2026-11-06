import type {
  CatchmentYearlyNLoadCaps,
  QuotaTradePrices,
  SavedResultView,
  Simulation,
  SimulationQuotaTrade,
} from '@/api/types'
import {
  formatNumber,
  formatWholeNumber,
  ROTATION_CALENDAR_YEARS,
} from '@/lib/field-domain'

// The trades of the simulation's latest run. A saved result from an earlier
// run is not the one its figures come from, so it has none to show.
export const latestQuotaTrades = (
  simulation: Simulation,
  savedResult: SavedResultView | null | undefined,
): SimulationQuotaTrade[] =>
  savedResult && savedResult.runId === simulation.result.runId
    ? (savedResult.response.quotaTrades ?? [])
    : []

// What the trades cost per year; negative when selling earns more than buying
// costs.
export const quotaTradePayment = (trades: SimulationQuotaTrade[]) =>
  trades.reduce((sum, trade) => sum + trade.paymentDkkPerYear, 0)

// What buying cost and what selling earned, each the average per year and at
// least 0. bought - sold is the trades' payment.
export const quotaTradeAmounts = (
  trades: SimulationQuotaTrade[],
): { bought: number; sold: number } => {
  let bought = 0
  let sold = 0
  for (const trade of trades) {
    const kgs = tradeKgs(trade)
    for (const kg of kgs) {
      if (kg > 0) bought += (kg * trade.buyPriceDkkPerKg) / kgs.length
      else sold += (-kg * trade.sellPriceDkkPerKg) / kgs.length
    }
  }
  return { bought, sold }
}

const tradeKgs = (trade: SimulationQuotaTrade) =>
  Object.values(trade.tradeKgByYear)

// The kvote traded in a calendar year, or with year null the average per year
// over the period.
export const quotaTradeKgIn = (
  trade: SimulationQuotaTrade,
  year: number | null,
): number => {
  if (year !== null) return trade.tradeKgByYear[year] ?? 0
  const kgs = tradeKgs(trade)
  return kgs.length === 0
    ? 0
    : kgs.reduce((sum, kg) => sum + kg, 0) / kgs.length
}

// A trade chosen year by year can still come out the same in every year.
export const quotaTradeVaries = (trade: SimulationQuotaTrade) =>
  new Set(tradeKgs(trade)).size > 1

const describeTradeKgs = (trade: SimulationQuotaTrade) => {
  const kgs = tradeKgs(trade)
  const min = Math.min(0, ...kgs)
  const max = Math.max(0, ...kgs)
  const kg = formatWholeNumber
  if (!quotaTradeVaries(trade)) {
    const only = kgs[0] ?? 0
    return only === 0
      ? null
      : `${only > 0 ? 'Køb' : 'Salg'} ${kg(Math.abs(only))} kg N/år`
  }
  if (min < 0 && max > 0)
    return `Køb op til ${kg(max)} og salg op til ${kg(-min)} kg N/år`
  const sorted = kgs.map(Math.abs).sort((a, b) => a - b)
  return `${max > 0 ? 'Køb' : 'Salg'} ${kg(sorted[0])}–${kg(
    sorted[sorted.length - 1],
  )} kg N/år`
}

// The price a trade of tradeKg is paid at: the buy price when it buys, the
// sell price when it sells.
export const tradePriceDkkPerKg = (
  prices: QuotaTradePrices,
  tradeKg: number,
) => (tradeKg >= 0 ? prices.buyPriceDkkPerKg : prices.sellPriceDkkPerKg)

// "35 kr/kg N", or "køb 35, salg 30 kr/kg N" when the prices differ.
export const describeTradePrices = (prices: QuotaTradePrices) =>
  prices.buyPriceDkkPerKg === prices.sellPriceDkkPerKg
    ? `${formatNumber(prices.buyPriceDkkPerKg)} kr/kg N`
    : `køb ${formatNumber(prices.buyPriceDkkPerKg)}, salg ${formatNumber(
        prices.sellPriceDkkPerKg,
      )} kr/kg N`

export const describeQuotaTrade = (trade: SimulationQuotaTrade) => {
  const amount = describeTradeKgs(trade)
  if (amount === null) return 'Ingen handel'
  const kgs = tradeKgs(trade)
  const buys = kgs.some((kg) => kg > 0)
  const sells = kgs.some((kg) => kg < 0)
  const price =
    buys && sells
      ? describeTradePrices(trade)
      : `${formatNumber(tradePriceDkkPerKg(trade, sells ? -1 : 1))} kr/kg N`
  return `${amount} · ${price}`
}

export type QuotaTradeKind = 'bought' | 'sold'

export const QUOTA_TRADE_LABELS: Record<QuotaTradeKind, string> = {
  bought: 'Købt kvote',
  sold: 'Solgt kvote',
}

export const quotaTradeKind = (tradeKg: number): QuotaTradeKind | null =>
  tradeKg > 0 ? 'bought' : tradeKg < 0 ? 'sold' : null

// A kvote moved by a trade.
export type TradedLimit = {
  // The kvote the trade moved, rounded to whole kg N as the run's cap is by
  // default, or any other limit a bar is drawn to.
  capKgN: number
  tradeKg: number
}

// The limit a trading opland is held to: its kvote moved by the trade. The
// kvote status measures against it, so bought kvote that covers the
// udledning is not over the limit, and udledning above sold kvote is. A cap
// raised under Grænser does not move it: that kvote is not the farm's.
export const limitAfterTradeKgN = (limit: TradedLimit) =>
  limit.capKgN + limit.tradeKg

// An opland's limit in a calendar year after the run's trades: its kvote,
// rounded to whole kg N, moved by the year's trade. An opland that does not
// trade is held to its kvote.
export const limitAfterTradesFor =
  (trades: SimulationQuotaTrade[]) =>
  (catchmentId: number, calendarYear: number, quotaKgN: number): number => {
    const trade = trades.find((entry) => entry.catchmentId === catchmentId)
    if (!trade) return quotaKgN
    return limitAfterTradeKgN({
      capKgN: Math.round(quotaKgN),
      tradeKg: quotaTradeKgIn(trade, calendarYear),
    })
  }

// The same limit as limitAfterTradesFor, averaged over the period, for a
// status of the average year.
export const averageLimitAfterTradesFor = (trades: SimulationQuotaTrade[]) => {
  const limitFor = limitAfterTradesFor(trades)
  return (catchmentId: number, quotaKgN: number): number =>
    ROTATION_CALENDAR_YEARS.reduce(
      (sum, year) => sum + limitFor(catchmentId, year, quotaKgN),
      0,
    ) / ROTATION_CALENDAR_YEARS.length
}

// An opland's own limit in a calendar year: the cap saved under Grænser, or
// its kvote where none is saved. With calendarYear null, the average over the
// period.
export const yearLimitKgN = (
  caps: CatchmentYearlyNLoadCaps[],
  catchmentId: number | null,
  calendarYear: number | null,
  quotaKgN: number,
): number => {
  const saved = caps.find(
    (cap) => cap.catchmentId === catchmentId,
  )?.maxNLoadByYear
  if (!saved) return quotaKgN
  const limitIn = (year: number) => saved[year] ?? quotaKgN
  if (calendarYear !== null) return limitIn(calendarYear)
  return (
    ROTATION_CALENDAR_YEARS.reduce((sum, year) => sum + limitIn(year), 0) /
    ROTATION_CALENDAR_YEARS.length
  )
}

// Where a limit before any trade sits on a bar drawn so the kvote sits at
// quotaLinePct of its height. Without a limit, at the kvote.
export const quotaLimitLinePct = (
  quotaKgN: number,
  limit: TradedLimit | null,
  quotaLinePct: number,
): number =>
  limit === null || quotaKgN <= 0
    ? quotaLinePct
    : Math.min(100, Math.max(0, (limit.capKgN / quotaKgN) * quotaLinePct))

// Where a trade moves an opland's limit on a bar drawn so the original kvote
// sits at quotaLinePct of its height: between the cap and the traded one, in
// percent of the height.
export const quotaTradeBand = (
  quotaKgN: number,
  limit: TradedLimit,
  quotaLinePct: number,
): { kind: QuotaTradeKind; bottomPct: number; heightPct: number } | null => {
  const kind = quotaTradeKind(limit.tradeKg)
  if (kind === null || quotaKgN <= 0) return null
  const pctOf = (kg: number) =>
    Math.min(100, Math.max(0, (kg / quotaKgN) * quotaLinePct))
  const capPct = pctOf(limit.capKgN)
  const tradedPct = pctOf(limit.capKgN + limit.tradeKg)
  return {
    kind,
    bottomPct: Math.min(capPct, tradedPct),
    heightPct: Math.abs(tradedPct - capPct),
  }
}

// A bar scaled so the original kvote sits at quotaLinePct of its height: how
// tall it is, and which share of it (from the top, in percent of the bar) is
// over the kvote. Always the kvote from the opland's fields: udledning above
// it is marked even where bought kvote or a cap under Grænser covers it.
export const quotaBarHeights = (
  nLoadKg: number,
  quotaKgN: number,
  quotaLinePct: number,
): { heightPct: number; overPct: number } => {
  if (quotaKgN <= 0) return { heightPct: 0, overPct: 0 }
  const heightPct = Math.min(100, (nLoadKg / quotaKgN) * quotaLinePct)
  return {
    heightPct,
    overPct:
      heightPct > quotaLinePct
        ? ((heightPct - quotaLinePct) / heightPct) * 100
        : 0,
  }
}

// A trade as a share of the cap it moved, signed: "+51 %" bought, "−26 %"
// sold. null when there is no cap to compare with.
export const formatTradeShareOfCap = (limit: TradedLimit): string | null =>
  limit.capKgN > 0
    ? `${limit.tradeKg < 0 ? '−' : '+'}${formatWholeNumber(
        (Math.abs(limit.tradeKg) / limit.capKgN) * 100,
      )} %`
    : null

// A year's trade, or with average the average per year over the period:
// "Købt 171 kg N", "Solgt gns. 50 kg N/år".
export const describeTradeKg = (tradeKg: number, average: boolean) => {
  const kind = quotaTradeKind(tradeKg)
  if (kind === null)
    return average ? 'Ingen handel i gennemsnit' : 'Ingen handel i året'
  return `${kind === 'bought' ? 'Købt' : 'Solgt'}${average ? ' gns.' : ''} ${formatWholeNumber(
    Math.abs(tradeKg),
  )} kg N${average ? '/år' : ''}`
}

export const describeQuotaTradeAmount = (tradeKg: number) => {
  const kind = quotaTradeKind(tradeKg)
  return kind === null
    ? ''
    : `${QUOTA_TRADE_LABELS[kind]} ${formatWholeNumber(Math.abs(tradeKg))} kg N`
}

// average: the payment differs between years, so this is its average.
export const describeQuotaPayment = (payment: number, average = false) =>
  payment === 0
    ? '0 kr/år'
    : `${payment > 0 ? 'Betaler' : 'Modtager'}${
        average ? ' gns.' : ''
      } ${formatWholeNumber(Math.abs(payment))} kr/år`
