import type {
  SavedResultView,
  Simulation,
  SimulationQuotaTrade,
} from '@/api/types'
import { formatNumber, formatWholeNumber } from '@/lib/field-domain'

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

export const describeQuotaTrade = (trade: SimulationQuotaTrade) =>
  trade.tradeKg === 0
    ? 'Ingen handel'
    : `${trade.tradeKg > 0 ? 'Køb' : 'Salg'} ${formatWholeNumber(
        Math.abs(trade.tradeKg),
      )} kg N/år · ${formatNumber(trade.priceDkkPerKg)} kr/kg N`

export type QuotaTradeKind = 'bought' | 'sold'

export const QUOTA_TRADE_LABELS: Record<QuotaTradeKind, string> = {
  bought: 'Købt kvote',
  sold: 'Solgt kvote',
}

export const quotaTradeKind = (tradeKg: number): QuotaTradeKind | null =>
  tradeKg > 0 ? 'bought' : tradeKg < 0 ? 'sold' : null

// The limit after a trade, as the run set it: the kvote rounded to whole kg
// N, like the cap it defaults to, moved by the trade. Without a trade the
// limit is the kvote itself.
export const tradedLimitKgN = (quotaKgN: number, tradeKg: number) =>
  tradeKg === 0 ? quotaKgN : Math.round(quotaKgN) + tradeKg

// Where a trade moves an opland's kvote on a bar drawn so the original kvote
// sits at quotaLinePct of its height: between the original kvote and the
// traded one, in percent of the height.
export const quotaTradeBand = (
  quotaKgN: number,
  tradeKg: number,
  quotaLinePct: number,
): { kind: QuotaTradeKind; bottomPct: number; heightPct: number } | null => {
  const kind = quotaTradeKind(tradeKg)
  if (kind === null || quotaKgN <= 0) return null
  const tradedPct = Math.min(
    100,
    Math.max(0, (tradedLimitKgN(quotaKgN, tradeKg) / quotaKgN) * quotaLinePct),
  )
  return {
    kind,
    bottomPct: Math.min(quotaLinePct, tradedPct),
    heightPct: Math.abs(tradedPct - quotaLinePct),
  }
}

// A bar scaled so the original kvote sits at quotaLinePct of its height: how
// tall it is, and which share of it (from the top, in percent of the bar) is
// over the limit. After a trade the limit is the traded kvote, so udledning
// covered by bought kvote is not over it, and udledning above sold kvote is.
export const quotaBarHeights = (
  nLoadKg: number,
  quotaKgN: number,
  tradeKg: number,
  quotaLinePct: number,
): { heightPct: number; overPct: number } => {
  if (quotaKgN <= 0) return { heightPct: 0, overPct: 0 }
  const heightPct = Math.min(100, (nLoadKg / quotaKgN) * quotaLinePct)
  const limitPct = Math.max(
    0,
    (tradedLimitKgN(quotaKgN, tradeKg) / quotaKgN) * quotaLinePct,
  )
  return {
    heightPct,
    overPct:
      heightPct > limitPct ? ((heightPct - limitPct) / heightPct) * 100 : 0,
  }
}

export const describeQuotaTradeAmount = (tradeKg: number) => {
  const kind = quotaTradeKind(tradeKg)
  return kind === null
    ? ''
    : `${QUOTA_TRADE_LABELS[kind]} ${formatWholeNumber(Math.abs(tradeKg))} kg N`
}

export const describeQuotaPayment = (payment: number) =>
  payment === 0
    ? '0 kr/år'
    : `${payment > 0 ? 'Betaler' : 'Modtager'} ${formatWholeNumber(
        Math.abs(payment),
      )} kr/år`
