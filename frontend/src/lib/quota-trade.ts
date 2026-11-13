import type {
  FieldRecord,
  QuotaProgressStep,
  QuotaTradeRange,
  QuotaValueCurve,
  QuotaValuePoint,
} from '@/api/types'
import { formatNameList } from '@/lib/economics'
import {
  formatSigned,
  formatWholeNumber,
  isFieldLocked,
} from '@/lib/field-domain'
import { catchmentQuotaKgN, quotaTradeBlock } from '@/lib/quota-trade-settings'

export type SolvedQuotaPoint = QuotaValuePoint & { db2: number }

export type GainPoint = {
  tradeKg: number
  // V(t) - p * t - V(0): yearly gain of this trade over not trading, or over
  // the least purchase when the catchment must buy.
  gain: number
  // The same with V(t) at its proven upper bound: the best plan for this trade
  // gains between gain and gainUpperBound. Null when the point has no bound.
  gainUpperBound: number | null
  point: SolvedQuotaPoint
}

export const isSolved = (point: QuotaValuePoint): point is SolvedQuotaPoint =>
  (point.status === 'OPTIMAL' || point.status === 'FEASIBLE') &&
  point.db2 !== null

export const tradeGain = (
  point: SolvedQuotaPoint,
  baseDb2: number,
  priceKrPerKg: number,
  fromKg = 0,
): number => point.db2 - priceKrPerKg * (point.tradeKg - fromKg) - baseDb2

export const gainPoints = (
  curve: QuotaValueCurve,
  baseDb2: number,
  priceKrPerKg: number,
): GainPoint[] =>
  curve.points
    .filter(isSolved)
    .map((point) => ({
      tradeKg: point.tradeKg,
      gain: tradeGain(point, baseDb2, priceKrPerKg, curve.minimumPurchaseKg),
      gainUpperBound:
        point.db2UpperBound === null
          ? null
          : tradeGain(
              { ...point, db2: point.db2UpperBound },
              baseDb2,
              priceKrPerKg,
              curve.minimumPurchaseKg,
            ),
      point,
    }))
    .sort((a, b) => a.tradeKg - b.tradeKg)

// Other trades that might still beat the best one: their upper bound reaches
// above the best trade's proven gain. V(0) is the same in every gain, so its
// own uncertainty does not change the comparison. A point without a bound
// cannot be ruled out.
export const rivalTrades = (
  points: GainPoint[],
  best: GainPoint,
): GainPoint[] =>
  points.filter(
    (point) =>
      point.tradeKg !== best.tradeKg &&
      (point.gainUpperBound === null || point.gainUpperBound > best.gain),
  )

// The trade with the highest gain; ties go to the smaller trade, so equal
// gains never suggest trading more than needed.
export const bestTrade = (points: GainPoint[]): GainPoint | null =>
  points.reduce<GainPoint | null>(
    (best, candidate) =>
      best === null ||
      candidate.gain > best.gain ||
      (candidate.gain === best.gain &&
        Math.abs(candidate.tradeKg) < Math.abs(best.tradeKg))
        ? candidate
        : best,
    null,
  )

export type PriceThreshold = {
  // The price where this side stops (buying) or starts (selling) being best.
  priceKrPerKg: number
  // The trade that is best right at that side of the price.
  tradeKg: number
}

export type PriceThresholds = {
  // Buying is best below this price; null if it is best at no positive price.
  buyBelow: PriceThreshold | null
  // Selling is best above this price; null if no selling point was solved.
  sellAbove: PriceThreshold | null
}

type Limit = { tradeKg: number; price: number }

// The price where trade t and rival s are worth the same: t gains
// V(t) - V(s) for t - s more kg.
const breakEven = (t: SolvedQuotaPoint, s: SolvedQuotaPoint) =>
  (t.db2 - s.db2) / (t.tradeKg - s.tradeKg)

// The prices at which the best trade switches from buying to no trade, and
// from no trade to selling, among the found solutions of one curve. A buying
// trade beats a rival s (no trade or selling) while the price is below their
// break-even price, so it stays best up to the lowest one; buying is best up to
// the highest such price over the buying trades. Selling mirrors it. When the
// catchment must buy, buying means buying more than the least purchase.
export const priceThresholds = (curve: QuotaValueCurve): PriceThresholds => {
  const from = curve.minimumPurchaseKg
  const solved = curve.points.filter(isSolved)
  const buying = solved.filter((point) => point.tradeKg > from)
  const notBuying = solved.filter((point) => point.tradeKg <= from)
  const selling = solved.filter((point) => point.tradeKg < from)
  const notSelling = solved.filter((point) => point.tradeKg >= from)

  const buy = buying
    .map<Limit>((t) => ({
      tradeKg: t.tradeKg,
      price: Math.min(...notBuying.map((s) => breakEven(t, s))),
    }))
    .reduce<Limit | null>(
      (best, limit) =>
        best === null || limit.price > best.price ? limit : best,
      null,
    )
  const sell = selling
    .map<Limit>((t) => ({
      tradeKg: t.tradeKg,
      price: Math.max(...notSelling.map((s) => breakEven(s, t))),
    }))
    .reduce<Limit | null>(
      (best, limit) =>
        best === null || limit.price < best.price ? limit : best,
      null,
    )
  return {
    buyBelow:
      buy && notBuying.length > 0 && buy.price > 0
        ? { priceKrPerKg: buy.price, tradeKg: buy.tradeKg }
        : null,
    // Selling spare kvote that costs nothing pays at any positive price.
    sellAbove:
      sell && notSelling.length > 0
        ? { priceKrPerKg: Math.max(0, sell.price), tradeKg: sell.tradeKg }
        : null,
  }
}

// The most that can be sold: below it the plan cannot meet the other rules.
export const lowestFeasibleTradeKg = (
  curve: QuotaValueCurve,
): number | null => {
  const solved = curve.points.filter(isSolved)
  return solved.length > 0
    ? Math.min(...solved.map((point) => point.tradeKg))
    : null
}

export type SellingLimit =
  | { kind: 'proven'; lowestKg: number }
  | { kind: 'undetermined'; lowestKg: number }

// How far selling was followed: proven when the next step down is infeasible,
// undetermined when the optimization found no answer there in time.
export const sellingLimit = (curve: QuotaValueCurve): SellingLimit | null => {
  const lowestKg = lowestFeasibleTradeKg(curve)
  if (lowestKg === null) return null
  const below = curve.points
    .filter((point) => point.tradeKg < lowestKg)
    .sort((a, b) => b.tradeKg - a.tradeKg)[0]
  if (below?.status === 'INFEASIBLE') return { kind: 'proven', lowestKg }
  if (below?.status === 'UNKNOWN') return { kind: 'undetermined', lowestKg }
  return null
}

export const describeTrade = (tradeKg: number): string => {
  const amount = `${formatWholeNumber(Math.abs(tradeKg))} kg N/år`
  if (tradeKg > 0) return `Køb ${amount}`
  if (tradeKg < 0) return `Salg ${amount}`
  return 'Ingen handel'
}

// "salg 27 kg N/år", for the middle of a sentence.
export const describeTradeInSentence = (tradeKg: number): string => {
  const text = describeTrade(tradeKg)
  return text.charAt(0).toLowerCase() + text.slice(1)
}

// "køb 20 kg N/år, salg 10 kg N/år og ingen handel"
export const listTrades = (tradesKg: number[]): string =>
  formatNameList(tradesKg.map(describeTradeInSentence))

export const formatPrice = (price: number) =>
  price.toLocaleString('da-DK', { maximumFractionDigits: 1 })

// The name of a simulation created from a trade, e.g. "Simulering A · Køb 53
// kg N/år · Lillebælt · 35 kr/kg N". The catchment is named only when the
// farm has several, and the price only for an actual trade: it does not
// change the plan of no trade.
export const tradeSimulationName = ({
  originalName,
  tradeKg,
  catchmentName,
  priceKrPerKg,
}: {
  originalName: string
  tradeKg: number
  catchmentName: string | null
  priceKrPerKg: number
}) =>
  [
    originalName,
    describeTrade(tradeKg),
    catchmentName,
    tradeKg !== 0
      ? `${priceKrPerKg.toLocaleString('da-DK', { maximumFractionDigits: 2 })} kr/kg N`
      : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')

// A non-negative price in kr/kg, accepting a Danish decimal comma.
export const parsePrice = (input: string): number | null => {
  const normalised = input.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null
  return Number(normalised)
}

// kg N per year, which may be negative (selling); accepts a decimal comma and
// a typographic minus.
export const parseKg = (input: string): number | null => {
  const normalised = input
    .trim()
    .replace(/\s/g, '')
    .replace('−', '-')
    .replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null
  return Number(normalised)
}

// Matches the backend's limit: every trade is a solve within one job.
export const MAX_RANGE_TRADES = 40

// Every trade of a chosen range except no trade, ascending: multiples of the
// step, so they line up with 0, plus both ends. Mirrors the backend.
export const rangeTrades = ({ minKg, maxKg, stepKg }: QuotaTradeRange) => {
  const first = Math.ceil(minKg / stepKg - 1e-9)
  const last = Math.floor(maxKg / stepKg + 1e-9)
  const trades = new Set([minKg, maxKg])
  for (let k = first; k <= last; k += 1) {
    trades.add(Math.round(k * stepKg * 1e6) / 1e6)
  }
  return [...trades].filter((trade) => trade !== 0).sort((a, b) => a - b)
}

export type TradeRangeCheck =
  | { kind: 'ok'; range: QuotaTradeRange; trades: number[] }
  | { kind: 'invalid'; message: string }

export const checkTradeRange = (
  minInput: string,
  maxInput: string,
  stepInput: string,
): TradeRangeCheck => {
  const minKg = parseKg(minInput)
  const maxKg = parseKg(maxInput)
  const stepKg = parseKg(stepInput)
  if (minKg === null || maxKg === null || stepKg === null) {
    return {
      kind: 'invalid',
      message:
        'Skriv interval og afstand som tal i kg N/år, fx -100, 150 og 50.',
    }
  }
  if (stepKg <= 0) {
    return { kind: 'invalid', message: 'Afstanden skal være større end 0.' }
  }
  if (minKg >= maxKg) {
    return {
      kind: 'invalid',
      message: 'Intervallets start skal være mindre end dets slutning.',
    }
  }
  // (max - min) / step bounds the count, so a tiny step is rejected before
  // its trades are listed.
  const range = { minKg, maxKg, stepKg }
  if (
    (maxKg - minKg) / stepKg > MAX_RANGE_TRADES + 1 ||
    rangeTrades(range).length > MAX_RANGE_TRADES
  ) {
    return {
      kind: 'invalid',
      message: `Intervallet giver mere end ${MAX_RANGE_TRADES} handler. Vælg en større afstand eller et mindre interval.`,
    }
  }
  return { kind: 'ok', range, trades: rangeTrades(range) }
}

export const describeTradeRange = ({ minKg, maxKg, stepKg }: QuotaTradeRange) =>
  `${formatSigned(minKg, formatWholeNumber)} til ${formatSigned(maxKg, formatWholeNumber)} kg N/år, hver ${formatWholeNumber(stepKg)} kg`

export type QuotaYearRow = {
  year: string
  nLoad: number
  // The catchment's kvote plus the trade: what it may let out that year.
  quotaAfterTrade: number
  feedUnits: number
}

export const quotaYearRows = (
  point: QuotaValuePoint,
  quotaKgN: number,
): QuotaYearRow[] =>
  Object.keys(point.nLoadByYear)
    .sort()
    .map((year) => ({
      year,
      nLoad: point.nLoadByYear[year],
      quotaAfterTrade: quotaKgN + point.tradeKg,
      feedUnits: point.feedUnitsByYear[year] ?? 0,
    }))

export type TradableCatchment = {
  catchmentId: number
  quotaKgN: number
  fieldCount: number
  lockedCount: number
}

// The catchments a curve can be computed for: a kvote and kvotegivende marker.
export const tradableCatchments = (
  fields: FieldRecord[],
): TradableCatchment[] =>
  [
    ...new Set(
      fields.flatMap((field) =>
        field.catchmentId !== null && field.quotaEligible
          ? [field.catchmentId]
          : [],
      ),
    ),
  ]
    .filter((catchmentId) => quotaTradeBlock(catchmentId, fields) === null)
    .map((catchmentId) => {
      const quotaFields = fields.filter(
        (field) => field.catchmentId === catchmentId && field.quotaEligible,
      )
      return {
        catchmentId,
        quotaKgN: catchmentQuotaKgN(catchmentId, fields),
        fieldCount: quotaFields.length,
        lockedCount: quotaFields.filter(isFieldLocked).length,
      }
    })
    .filter((catchment) => catchment.quotaKgN > 0)

export type TradeKind = 'buy' | 'sell' | 'none'

export const tradeKind = (tradeKg: number): TradeKind =>
  tradeKg > 0 ? 'buy' : tradeKg < 0 ? 'sell' : 'none'

export const bestTradeAt = (
  output: { baseDb2: number; curve: QuotaValueCurve },
  priceKrPerKg: number,
): GainPoint | null =>
  bestTrade(gainPoints(output.curve, output.baseDb2, priceKrPerKg))

export type GainScale = { min: number; max: number; ticks: number[] }

const niceStep = (span: number) => {
  const raw = span / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw)!
  return step * power
}

export const gainScale = (points: GainPoint[]): GainScale => {
  const values = points.flatMap((point) => [
    point.gain,
    point.gainUpperBound ?? point.gain,
  ])
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  if (low === high) return { min: 0, max: 1, ticks: [0] }
  const step = niceStep(high - low)
  const min = Math.floor(low / step) * step
  const max = Math.ceil(high / step) * step
  const ticks: number[] = []
  for (let tick = min; tick <= max + step / 2; tick += step) {
    ticks.push(Math.round(tick * 1e6) / 1e6)
  }
  return { min, max, ticks }
}

export const describeComputedAt = (iso: string, now = new Date()): string => {
  const at = new Date(iso)
  return at.toDateString() === now.toDateString()
    ? `Beregnet kl. ${at.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}`
    : `Beregnet ${at.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}`
}

export const progressFraction = (steps: QuotaProgressStep[]): number =>
  steps.length === 0
    ? 0
    : steps.reduce((sum, step) => {
        if (step.state === 'done' || step.state === 'skipped') return sum + 1
        if (step.state === 'running')
          return (
            sum + (step.total ? Math.min(0.95, step.done / step.total) : 0.5)
          )
        return sum
      }, 0) / steps.length
