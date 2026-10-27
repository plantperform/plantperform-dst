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

export const describeQuotaPayment = (payment: number) =>
  payment === 0
    ? '0 kr/år'
    : `${payment > 0 ? 'Betaler' : 'Modtager'} ${formatWholeNumber(
        Math.abs(payment),
      )} kr/år`
