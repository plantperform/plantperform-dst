import { describe, expect, it } from 'vitest'

import type {
  QuotaProgressStep,
  QuotaValueCurve,
  QuotaValuePoint,
} from '@/api/types'
import {
  bestTrade,
  checkTradeRange,
  describeQuotaTrade,
  describeTrade,
  gainPoints,
  sellingLimit,
  interactionCheck,
  lowestFeasibleTradeKg,
  formatElapsed,
  parseKg,
  parsePrice,
  priceThresholds,
  rangeTrades,
  progressCount,
  progressLabel,
  quotaTradePayment,
  quotaYearRows,
  rivalTrades,
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
  capByYear: { '2027': 100 + tradeKg, '2028': 100 + tradeKg },
  feedUnitsByYear: { '2027': 500, '2028': 0 },
  changedFields: [],
  rotations: [],
})

// V(0) = 1500; V(50) = 2500; V(100) = 3500; V(130) = 4500; selling is infeasible.
const curve: QuotaValueCurve = {
  catchmentId: 233,
  baseCapByYear: { '2027': 100, '2028': 100 },
  unconstrainedTradeKg: 130,
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
      'Scenarie A – Køb 53 kg N/år – Lillebælt – 35 kr/kg',
    )
    expect(name(-27, null, 37.5)).toBe(
      'Scenarie A – Sælg 27 kg N/år – 37,5 kr/kg',
    )
    // The price does not change the plan without trade.
    expect(name(0, 'Lillebælt')).toBe('Scenarie A – Ingen handel – Lillebælt')
  })

  it('describes trades in Danish', () => {
    expect(describeTrade(200)).toBe('Køb 200 kg N/år')
    expect(describeTrade(-1250)).toBe('Sælg 1.250 kg N/år')
    expect(describeTrade(0)).toBe('Ingen handel')
  })

  it('accepts prices with a decimal comma and rejects invalid ones', () => {
    expect(parsePrice('35')).toBe(35)
    expect(parsePrice(' 37,5 ')).toBe(37.5)
    expect(parsePrice('')).toBeNull()
    expect(parsePrice('-5')).toBeNull()
    expect(parsePrice('abc')).toBeNull()
  })

  it('lists the years in order', () => {
    expect(quotaYearRows(curve.points[2])).toEqual([
      { year: '2027', nLoad: 110, cap: 100, feedUnits: 500 },
      { year: '2028', nLoad: 120, cap: 100, feedUnits: 0 },
    ])
  })
})

describe('interaction between catchments', () => {
  const interaction = {
    priceKrPerKg: 30,
    tradesKg: { '233': 100, '244': 50 },
    separateGain: 4000,
    combinedStatus: 'OPTIMAL' as const,
    combinedGain: 3950,
  }

  it('is not shown for a single trading catchment', () => {
    expect(interactionCheck(null, 30)).toEqual({ kind: 'none' })
  })

  it('accepts small rounding differences', () => {
    expect(interactionCheck(interaction, 30)).toEqual({ kind: 'consistent' })
  })

  it('warns when the combined trade is worth clearly less', () => {
    expect(
      interactionCheck({ ...interaction, combinedGain: 2000 }, 30),
    ).toEqual({
      kind: 'differs',
      separateGain: 4000,
      combinedGain: 2000,
    })
  })

  it('says when the check was made at another price', () => {
    expect(interactionCheck(interaction, 45)).toEqual({
      kind: 'other-price',
      computedAt: 30,
    })
  })
})

describe('progress of a running curve', () => {
  const step = (
    state: QuotaProgressStep['state'],
    done: number,
    total: number | null,
  ): QuotaProgressStep => ({
    key: 'buying',
    catchmentId: 233,
    state,
    done,
    total,
  })

  it('counts solves against the total once it is known', () => {
    expect(progressCount(step('running', 2, 3))).toBe('2 / 3')
    expect(progressCount(step('running', 2, null))).toBe('2')
    expect(progressCount(step('pending', 0, null))).toBe('')
    expect(progressCount(step('skipped', 0, 0))).toBe('Ikke nødvendig')
    expect(progressLabel(step('running', 0, 3))).toBe('Køb')
  })

  it('shows the elapsed time in minutes and seconds', () => {
    expect(formatElapsed(42.7)).toBe('42 s')
    expect(formatElapsed(100)).toBe('1 min 40 s')
    expect(formatElapsed(-3)).toBe('0 s')
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

describe('a simulation created from a trade', () => {
  const bought = {
    catchmentId: 123,
    catchmentName: 'Vejle Fjord, indre',
    tradeKg: 28,
    priceKrPerKg: 200,
  }

  it('pays for bought kvote and is paid for sold kvote', () => {
    expect(quotaTradePayment(bought)).toBe(-5600)
    expect(
      quotaTradePayment({ ...bought, tradeKg: -28, priceKrPerKg: 770 }),
    ).toBe(21560)
  })

  it('describes the trade with its catchment and price', () => {
    expect(describeQuotaTrade(bought)).toBe(
      'Køb 28 kg N/år i Vejle Fjord, indre til 200 kr/kg',
    )
    expect(
      describeQuotaTrade({
        ...bought,
        catchmentName: null,
        tradeKg: -27,
        priceKrPerKg: 37.5,
      }),
    ).toBe('Sælg 27 kg N/år til 37,5 kr/kg')
  })
})
