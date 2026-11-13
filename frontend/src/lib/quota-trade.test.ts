import { describe, expect, it } from 'vitest'

import type {
  FieldRecord,
  QuotaProgressStep,
  QuotaValueCurve,
  QuotaValuePoint,
} from '@/api/types'
import {
  bestTrade,
  checkTradeRange,
  describeComputedAt,
  describeTrade,
  gainPoints,
  sellingLimit,
  listTrades,
  lowestFeasibleTradeKg,
  gainScale,
  parseKg,
  parsePrice,
  priceThresholds,
  rangeTrades,
  progressFraction,
  quotaYearRows,
  rivalTrades,
  type GainPoint,
  tradableCatchments,
  tradeSimulationName,
} from '@/lib/quota-trade'

const point = (
  tradeKg: number,
  db2: number | null,
  status: QuotaValuePoint['status'] = 'OPTIMAL',
): QuotaValuePoint => ({
  tradeKg,
  status,
  db2,
  db2UpperBound: db2,
  solutionFromTradeKg: null,
  nLoadByYear: { '2028': 120, '2027': 110 },
  feedUnitsByYear: { '2027': 500, '2028': 0 },
  changedFields: [],
  rotations: [],
})

// V(0) = 1500; V(50) = 2500; V(100) = 3500; V(130) = 4500; selling is infeasible.
const curve: QuotaValueCurve = {
  catchmentId: 233,
  quotaKgN: 100,
  unconstrainedTradeKg: 130,
  minimumPurchaseKg: 0,
  points: [
    point(-25, null, 'INFEASIBLE'),
    point(130, 4500),
    point(0, 1500),
    point(50, 2500),
    point(100, 3500),
  ],
}

describe('quota trade gain', () => {
  it('shifts the curve so no trade is zero, and subtracts the price', () => {
    const points = gainPoints(curve, 1500, 20)
    expect(points.map((p) => p.tradeKg)).toEqual([0, 50, 100, 130])
    expect(points.map((p) => p.gain)).toEqual([0, 0, 0, 400])
  })

  it('counts from the least purchase when the catchment must buy', () => {
    // It must buy 50 kg; buying 50 more gains 1000 for 50 kg.
    const mustBuy = {
      ...curve,
      minimumPurchaseKg: 50,
      points: [point(50, 2500), point(100, 3500)],
    }
    expect(gainPoints(mustBuy, 2500, 10).map((p) => p.gain)).toEqual([0, 500])
    const { buyBelow, sellAbove } = priceThresholds(mustBuy)
    expect(buyBelow).toEqual({ priceKrPerKg: 20, tradeKg: 100 })
    expect(sellAbove).toBeNull()
  })

  it('picks the best trade, preferring the smaller trade on ties', () => {
    expect(bestTrade(gainPoints(curve, 1500, 10))?.tradeKg).toBe(130)
    expect(bestTrade(gainPoints(curve, 1500, 20))?.tradeKg).toBe(130)
    expect(bestTrade(gainPoints(curve, 1500, 40))?.tradeKg).toBe(0)
    expect(bestTrade([])).toBeNull()
  })

  it('carries the proven range of each point into its gain', () => {
    const ranged = {
      ...curve,
      points: [
        { ...point(0, 1500), db2UpperBound: 1600 },
        { ...point(50, 2500), db2UpperBound: null },
      ],
    }
    const points = gainPoints(ranged, 1500, 20)
    expect(points.map((p) => p.gainUpperBound)).toEqual([100, null])
  })

  it('names the trades that could still beat the best one', () => {
    // Gains at 20 kr/kg: 0, 0, 0, 400. +100 could reach 450, +50 at most 300.
    const ranged = {
      ...curve,
      points: [
        point(0, 1500),
        { ...point(50, 2500), db2UpperBound: 2800 },
        { ...point(100, 3500), db2UpperBound: 3950 },
        point(130, 4500),
      ],
    }
    const points = gainPoints(ranged, 1500, 20)
    const best = bestTrade(points)!
    expect(best.tradeKg).toBe(130)
    expect(rivalTrades(points, best).map((p) => p.tradeKg)).toEqual([100])
    expect(rivalTrades(gainPoints(curve, 1500, 20), best)).toEqual([])
  })

  it('reports how far selling goes and whether that limit is proven', () => {
    expect(lowestFeasibleTradeKg(curve)).toBe(0)
    expect(sellingLimit(curve)).toEqual({ kind: 'proven', lowestKg: 0 })
    const unknownBelow = {
      ...curve,
      points: [point(-50, null, 'UNKNOWN'), point(-25, 1200), point(0, 1500)],
    }
    expect(sellingLimit(unknownBelow)).toEqual({
      kind: 'undetermined',
      lowestKg: -25,
    })
    const stoppedAtEmptyCap = {
      ...curve,
      points: [point(-100, 900), point(0, 1500)],
    }
    expect(sellingLimit(stoppedAtEmptyCap)).toBeNull()
  })
})

describe('quota trade text and input', () => {
  it('names a simulation after its trade, and its catchment when there are several', () => {
    const name = (
      tradeKg: number,
      catchmentName: string | null,
      priceKrPerKg = 35,
    ) =>
      tradeSimulationName({
        originalName: 'Scenarie A',
        tradeKg,
        catchmentName,
        priceKrPerKg,
      })
    expect(name(53, 'Lillebælt')).toBe(
      'Scenarie A · Køb 53 kg N/år · Lillebælt · 35 kr/kg N',
    )
    expect(name(-27, null, 37.5)).toBe(
      'Scenarie A · Salg 27 kg N/år · 37,5 kr/kg N',
    )
    // The price does not change the plan without trade.
    expect(name(0, 'Lillebælt')).toBe('Scenarie A · Ingen handel · Lillebælt')
  })

  it('describes trades in Danish, also inside a sentence', () => {
    expect(describeTrade(200)).toBe('Køb 200 kg N/år')
    expect(describeTrade(-1250)).toBe('Salg 1.250 kg N/år')
    expect(describeTrade(0)).toBe('Ingen handel')
    expect(listTrades([-5, 0])).toBe('salg 5 kg N/år og ingen handel')
  })

  it('accepts prices with a decimal comma and rejects invalid ones', () => {
    expect(parsePrice('35')).toBe(35)
    expect(parsePrice(' 37,5 ')).toBe(37.5)
    expect(parsePrice('')).toBeNull()
    expect(parsePrice('-5')).toBeNull()
    expect(parsePrice('abc')).toBeNull()
  })

  it('lists the years in order with the kvote after the trade', () => {
    expect(quotaYearRows(curve.points[3], curve.quotaKgN)).toEqual([
      { year: '2027', nLoad: 110, quotaAfterTrade: 150, feedUnits: 500 },
      { year: '2028', nLoad: 120, quotaAfterTrade: 150, feedUnits: 0 },
    ])
  })
})

describe('catchments a curve can be computed for', () => {
  const field = (
    catchmentId: number | null,
    nLoadQuotaKgN: number,
    quotaEligible = true,
    locked = false,
  ) =>
    ({
      catchmentId,
      quotaEligible,
      nLoadQuotaKgN,
      rotationId: locked ? 'r' : null,
      allowedRotationIds: locked ? ['r'] : [],
    }) as FieldRecord

  it('need kvotegivende marker and a kvote, counted once per catchment', () => {
    const fields = [
      field(1, 20.3),
      field(1, 10.4, true, true),
      field(2, 30, false),
      field(3, 0),
      field(null, 40),
    ]
    expect(tradableCatchments(fields)).toEqual([
      { catchmentId: 1, quotaKgN: 31, fieldCount: 2, lockedCount: 1 },
    ])
  })
})

describe('chosen range of trades', () => {
  it('lines the trades up with no trade and keeps both ends', () => {
    expect(rangeTrades({ minKg: -100, maxKg: 150, stepKg: 50 })).toEqual([
      -100, -50, 50, 100, 150,
    ])
    expect(rangeTrades({ minKg: -45, maxKg: 50, stepKg: 20 })).toEqual([
      -45, -40, -20, 20, 40, 50,
    ])
    expect(rangeTrades({ minKg: 30, maxKg: 90, stepKg: 25 })).toEqual([
      30, 50, 75, 90,
    ])
  })

  it('reads negative amounts with a decimal comma or a typographic minus', () => {
    expect(parseKg('-100')).toBe(-100)
    expect(parseKg('− 12,5')).toBe(-12.5)
    expect(parseKg('abc')).toBeNull()
  })

  it('accepts a valid range and explains an invalid one', () => {
    expect(checkTradeRange('-100', '150', '50')).toEqual({
      kind: 'ok',
      range: { minKg: -100, maxKg: 150, stepKg: 50 },
      trades: [-100, -50, 50, 100, 150],
    })
    expect(checkTradeRange('50', '-50', '10').kind).toBe('invalid')
    expect(checkTradeRange('-100', '150', '0').kind).toBe('invalid')
    expect(checkTradeRange('', '150', '50').kind).toBe('invalid')
    // 41 trades besides no trade is one more than a job may solve.
    expect(checkTradeRange('-200', '200', '10').kind).toBe('ok')
    expect(checkTradeRange('-200', '210', '10').kind).toBe('invalid')
  })
})

describe('prices where buying or selling is best', () => {
  it('finds the highest price where buying beats every other trade', () => {
    // V(t) - 1500 per kg: +50 and +100 give 20 kr/kg, +130 gives 23,08.
    const { buyBelow, sellAbove } = priceThresholds(curve)
    expect(buyBelow?.tradeKg).toBe(130)
    expect(buyBelow?.priceKrPerKg).toBeCloseTo(3000 / 130)
    // Every selling point was infeasible.
    expect(sellAbove).toBeNull()
    // It agrees with the best trade just below and above that price.
    expect(bestTrade(gainPoints(curve, 1500, 23))?.tradeKg).toBe(130)
    expect(bestTrade(gainPoints(curve, 1500, 23.2))?.tradeKg).toBe(0)
  })

  it('finds the lowest price where selling is best, and the gap to no trade', () => {
    const traded = {
      ...curve,
      points: [
        point(-50, 600),
        point(-25, 1300),
        point(0, 1500),
        point(50, 2500),
      ],
    }
    const { buyBelow, sellAbove } = priceThresholds(traded)
    // Buying 50 beats no trade below 20 and selling 25 below 16 kr/kg.
    expect(buyBelow?.priceKrPerKg).toBeCloseTo(16)
    expect(buyBelow?.tradeKg).toBe(50)
    // Selling 25 beats no trade above 8 and buying 50 above 16 kr/kg;
    // selling 50 needs 19.
    expect(sellAbove?.priceKrPerKg).toBeCloseTo(16)
    expect(sellAbove?.tradeKg).toBe(-25)
  })

  it('leaves no-trade room between the two prices when it is best there', () => {
    const traded = {
      ...curve,
      points: [point(-50, 500), point(0, 1500), point(50, 2000)],
    }
    const { buyBelow, sellAbove } = priceThresholds(traded)
    expect(buyBelow?.priceKrPerKg).toBeCloseTo(10)
    expect(sellAbove?.priceKrPerKg).toBeCloseTo(20)
    expect(bestTrade(gainPoints(traded, 1500, 15))?.tradeKg).toBe(0)
  })

  it('reports no buying price when buying never pays', () => {
    const flat = {
      ...curve,
      points: [point(0, 1500), point(50, 1500)],
    }
    expect(priceThresholds(flat).buyBelow).toBeNull()
  })
})

describe('the bar chart scale', () => {
  const bar = (gain: number, gainUpperBound: number | null = null) =>
    ({ tradeKg: 0, gain, gainUpperBound }) as GainPoint

  it('keeps 0 and reaches the highest upper bound in round steps', () => {
    expect(gainScale([bar(0), bar(795, 935), bar(924)])).toEqual({
      min: 0,
      max: 1000,
      ticks: [0, 250, 500, 750, 1000],
    })
    expect(gainScale([bar(-120), bar(40)]).ticks).toEqual([
      -150, -100, -50, 0, 50,
    ])
  })

  it('names when a curve was computed', () => {
    const now = new Date(2026, 10, 12, 15, 0)
    expect(
      describeComputedAt(new Date(2026, 10, 12, 13, 5).toISOString(), now),
    ).toBe('Beregnet kl. 13.05')
    expect(
      describeComputedAt(new Date(2026, 10, 11, 9, 0).toISOString(), now),
    ).toBe('Beregnet 11. nov.')
  })
})

describe('how far a running curve has come', () => {
  const step = (
    key: QuotaProgressStep['key'],
    state: QuotaProgressStep['state'],
    done = 0,
    total: number | null = null,
  ): QuotaProgressStep => ({ key, state, done, total })

  it('counts finished and skipped steps whole and the running one by its solves', () => {
    expect(progressFraction([])).toBe(0)
    expect(
      progressFraction([
        step('base', 'done', 1, 1),
        step('uncapped', 'skipped'),
        step('buying', 'running', 1, 4),
        step('selling', 'pending'),
      ]),
    ).toBeCloseTo((1 + 1 + 0.25) / 4)
  })
})
