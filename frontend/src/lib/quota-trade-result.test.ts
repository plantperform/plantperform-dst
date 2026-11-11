import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type {
  FieldRecord,
  SavedResultView,
  Simulation,
  SimulationQuotaTrade,
} from '@/api/types'
import { fromWire } from '@/api/wire'
import { QuotaTradeFigures } from '@/components/farm/QuotaTradeFigures'
import {
  describeSeparateQuotas,
  resolveFarmQuota,
  ROTATION_CALENDAR_YEARS,
  type FieldTotals,
} from '@/lib/field-domain'
import {
  db2IncludingQuotaTrades,
  describeAfterTrade,
  describeQuotaTrade,
  describeQuotaTradeAmount,
  describeQuotaTradePeriod,
  describeTradeKg,
  describeTradePrices,
  latestQuotaTrades,
  quotaBarHeights,
  quotaLimitLinePct,
  quotaTradeBand,
  quotaTradeKgIn,
  quotaTradeAmounts,
  quotaTradePayment,
  quotaTradeVaries,
  tradePriceDkkPerKg,
  limitAfterTradeIn,
  limitAfterTradeKgN,
  limitAfterTradesFor,
  averageLimitAfterTradesFor,
  yearLimitKgN,
} from '@/lib/quota-trade-result'

const everyYear = (kg: number) =>
  Object.fromEntries(ROTATION_CALENDAR_YEARS.map((year) => [year, kg]))

// The first year trades first, the rest second.
const byYear = (first: number, rest: number) => ({
  ...everyYear(rest),
  [ROTATION_CALENDAR_YEARS[0]]: first,
})

const buy: SimulationQuotaTrade = {
  catchmentId: 1,
  catchmentName: 'Kolding Fjord, indre',
  tradeKgByYear: everyYear(120),
  buyPriceDkkPerKg: 35,
  sellPriceDkkPerKg: 30,
  sameEachYear: true,
  paymentDkkPerYear: 4_200,
}
const sell: SimulationQuotaTrade = {
  catchmentId: 2,
  catchmentName: null,
  tradeKgByYear: everyYear(-50),
  buyPriceDkkPerKg: 40,
  sellPriceDkkPerKg: 35.5,
  sameEachYear: true,
  paymentDkkPerYear: -1_775,
}

const simulation = { result: { runId: 'run-2' } } as Simulation
const saved = (runId: string, quotaTrades?: SimulationQuotaTrade[]) =>
  ({ runId, response: { quotaTrades } }) as SavedResultView

describe('kvotehandel results', () => {
  it('reads the trades the API sends with the saved run', () => {
    const response = fromWire<{ quotaTrades: SimulationQuotaTrade[] }>({
      quotaTrades: [
        {
          kystvandId: 1,
          kystvandNavn: 'Kolding Fjord, indre',
          tradeKgByYear: everyYear(120),
          buyPriceKrPerKg: 35,
          sellPriceKrPerKg: 30,
          sameEachYear: true,
          paymentKrPerYear: 4_200,
        },
      ],
    })
    expect(response.quotaTrades).toEqual([buy])
  })

  it('shows only the trades of the latest run', () => {
    expect(latestQuotaTrades(simulation, saved('run-2', [buy]))).toEqual([buy])
    expect(latestQuotaTrades(simulation, saved('run-1', [buy]))).toEqual([])
    // Runs from before kvotehandel saved no trades at all.
    expect(latestQuotaTrades(simulation, saved('run-2'))).toEqual([])
    expect(latestQuotaTrades(simulation, null)).toEqual([])
  })

  it('describes buying, selling and what it costs per year', () => {
    expect(describeQuotaTrade(buy)).toBe('Køb 120 kg N/år · 35 kr/kg N')
    expect(describeQuotaTrade(sell)).toBe('Salg 50 kg N/år · 35,5 kr/kg N')
    expect(describeQuotaTrade({ ...buy, tradeKgByYear: everyYear(0) })).toBe(
      'Ingen handel',
    )
    expect(quotaTradePayment([buy, sell])).toBe(2_425)
  })

  it('describes the period’s trade in kg, years, price and payment', () => {
    expect(describeQuotaTradePeriod(buy)).toBe(
      'Køber 120 kg N i 8 år til 35 kr. Udgift gns. 4.200 kr/år',
    )
    expect(describeQuotaTradePeriod(sell)).toBe(
      'Sælger 50 kg N i 8 år til 35,5 kr. Indtægt gns. 1.775 kr/år',
    )
    expect(
      describeQuotaTradePeriod({
        ...buy,
        tradeKgByYear: byYear(-40, 90),
        paymentDkkPerYear: 2_606.25,
      }),
    ).toBe(
      'Køber 90 kg N i 7 år til 35 kr, sælger 40 kg N i 1 år til 30 kr. Udgift gns. 2.606 kr/år',
    )
    expect(
      describeQuotaTradePeriod({ ...buy, tradeKgByYear: byYear(30, 60) }),
    ).toContain('Køber 30-60 kg N i 8 år')
    expect(
      describeQuotaTradePeriod({ ...buy, tradeKgByYear: everyYear(0) }),
    ).toBe('Ingen handel i perioden')
  })

  it('holds a trading opland to its kvote moved by the year’s trade', () => {
    const [first, second] = ROTATION_CALENDAR_YEARS
    const limitFor = limitAfterTradesFor([
      { ...buy, tradeKgByYear: byYear(30, 50) },
    ])
    // The kvote rounded to whole kg N, like the run's default cap, moved by
    // the trade; a cap raised under Grænser does not count.
    expect(limitFor(1, first, 99.6)).toBe(130)
    expect(limitFor(1, second, 99.6)).toBe(150)
    // An opland that does not trade keeps its kvote.
    expect(limitFor(2, first, 99.6)).toBe(99.6)
    expect(limitAfterTradeKgN({ capKgN: 100, tradeKg: -30 })).toBe(70)
  })

  it('counts an opland over its limit only after its trade, on average', () => {
    const field = (catchmentId: number, nLoad: number) =>
      ({
        id: `field-${catchmentId}`,
        catchmentId,
        rotationId: 'rotation',
        quotaEligible: true,
        nLoadQuotaKgN: 100,
        nLoad,
        db2: 0,
        leaching: nLoad,
        feedUnits: 0,
        areaHa: 1,
      }) as FieldRecord
    const fields = [field(1, 120), field(2, 80)]
    expect(describeSeparateQuotas(resolveFarmQuota(fields, true))).toBe(
      '1 af 2 oplande over grænsen',
    )
    // Opland 1 buys 30 kg N in the first year and 10 kg N after it: 12.5 kg N
    // on average covers its 20 kg N over the kvote only in part.
    const limitFor = (laterKg: number) =>
      averageLimitAfterTradesFor([
        { ...buy, tradeKgByYear: byYear(30, laterKg) },
      ])
    expect(limitFor(10)(1, 100)).toBe(112.5)
    expect(
      describeSeparateQuotas(resolveFarmQuota(fields, true, limitFor(10))),
    ).toBe('1 af 2 oplande over grænsen')
    expect(
      describeSeparateQuotas(resolveFarmQuota(fields, true, limitFor(30))),
    ).toBe('alle 2 oplande under grænsen')
  })

  it('names the limit and the trade of a year or the period', () => {
    const mixed = { ...buy, tradeKgByYear: byYear(-40, 120) }
    expect(limitAfterTradeIn(mixed, ROTATION_CALENDAR_YEARS[0], 99.6)).toBe(60)
    expect(limitAfterTradeIn(mixed, null, 99.6)).toBe(100 + (7 * 120 - 40) / 8)
    expect(describeAfterTrade(mixed, ROTATION_CALENDAR_YEARS[0])).toBe(
      'efter salg',
    )
    expect(describeAfterTrade(mixed, ROTATION_CALENDAR_YEARS[1])).toBe(
      'efter køb',
    )
    expect(describeAfterTrade(mixed, null)).toBe('efter kvotehandel')
    expect(
      describeAfterTrade({ ...buy, tradeKgByYear: byYear(0, 30) }, null),
    ).toBe('efter køb')
    expect(
      describeAfterTrade({ ...buy, tradeKgByYear: everyYear(0) }, null),
    ).toBe('')
  })

  it('rates an opland that trades up to its limit as under it, not close to it', () => {
    const fields = [
      {
        id: 'field-1',
        catchmentId: 1,
        rotationId: 'rotation',
        quotaEligible: true,
        nLoadQuotaKgN: 100,
        nLoad: 129,
        db2: 0,
        leaching: 129,
        feedUnits: 0,
        areaHa: 1,
      } as FieldRecord,
    ]
    const limitFor = averageLimitAfterTradesFor([
      { ...buy, tradeKgByYear: everyYear(30) },
    ])
    expect(resolveFarmQuota(fields, true, limitFor).level).toBe('near')
    expect(resolveFarmQuota(fields, true, limitFor, new Set([1])).level).toBe(
      'ok',
    )
    expect(
      resolveFarmQuota(
        [{ ...fields[0], nLoad: 131, leaching: 131 }],
        true,
        limitFor,
        new Set([1]),
      ).level,
    ).toBe('over')
  })

  it('splits the payment into what buying cost and selling earned', () => {
    // Bought 120 kg N at 35 kr every year; sold 50 kg N at 35,5 kr.
    expect(quotaTradeAmounts([buy, sell])).toEqual({
      bought: 4_200,
      sold: 1_775,
    })
    // A trade that buys 30 kg N in one year and sells 40 kg N in the others.
    const mixed = { ...buy, tradeKgByYear: byYear(30, -40) }
    expect(quotaTradeAmounts([mixed])).toEqual({
      bought: (30 * 35) / 8,
      sold: (7 * 40 * 30) / 8,
    })
    expect(quotaTradeAmounts([])).toEqual({ bought: 0, sold: 0 })
  })

  it('pays a trade at the price of its direction', () => {
    expect(tradePriceDkkPerKg(buy, 120)).toBe(35)
    expect(tradePriceDkkPerKg(buy, -50)).toBe(30)
    expect(describeTradePrices(buy)).toBe('køb 35, salg 30 kr/kg N')
    expect(
      describeTradePrices({ buyPriceDkkPerKg: 35, sellPriceDkkPerKg: 35 }),
    ).toBe('35 kr/kg N')
  })

  it('describes a trade that differs between years by its range', () => {
    const trade = (first: number, rest: number) => ({
      ...buy,
      sameEachYear: false,
      tradeKgByYear: byYear(first, rest),
    })
    expect(describeQuotaTrade(trade(90, 50))).toBe(
      'Køb 50–90 kg N/år · 35 kr/kg N',
    )
    expect(describeQuotaTrade(trade(0, 50))).toBe(
      'Køb 0–50 kg N/år · 35 kr/kg N',
    )
    // Selling shows the sell price, and buying and selling both prices.
    expect(describeQuotaTrade(trade(-40, -100))).toBe(
      'Salg 40–100 kg N/år · 30 kr/kg N',
    )
    expect(describeQuotaTrade(trade(-40, 120))).toBe(
      'Køb op til 120 og salg op til 40 kg N/år · køb 35, salg 30 kr/kg N',
    )
    expect(quotaTradeVaries(trade(90, 50))).toBe(true)
    // Chosen year by year, but the same in every year.
    expect(quotaTradeVaries(trade(50, 50))).toBe(false)
    expect(describeQuotaTrade(trade(50, 50))).toBe(
      'Køb 50 kg N/år · 35 kr/kg N',
    )
  })

  it('reads the trade of a year, or its average over the period', () => {
    const trade = { ...buy, tradeKgByYear: byYear(-40, 120) }
    expect(quotaTradeKgIn(trade, ROTATION_CALENDAR_YEARS[0])).toBe(-40)
    expect(quotaTradeKgIn(trade, ROTATION_CALENDAR_YEARS[1])).toBe(120)
    // Seven years of 120 kg and one of -40 kg.
    expect(quotaTradeKgIn(trade, null)).toBe((7 * 120 - 40) / 8)
    expect(quotaTradeKgIn(trade, 1990)).toBe(0)
  })

  it('takes each year’s own limit from Grænser, or else the kvote', () => {
    const [first, second] = ROTATION_CALENDAR_YEARS
    const caps = [
      { catchmentId: 1, maxNLoadByYear: { ...everyYear(337), [first]: 150 } },
    ]
    expect(yearLimitKgN(caps, 1, first, 336.7)).toBe(150)
    expect(yearLimitKgN(caps, 1, second, 336.7)).toBe(337)
    expect(yearLimitKgN(caps, 1, null, 336.7)).toBe((150 + 7 * 337) / 8)
    // No caps saved for the opland: the kvote itself, not rounded.
    expect(yearLimitKgN(caps, 2, first, 99.6)).toBe(99.6)
    // A year left without a cap ("Ingen grænse") falls back to the kvote.
    const gap = [{ catchmentId: 1, maxNLoadByYear: { [first]: 150 } }]
    expect(yearLimitKgN(gap, 1, second, 99.6)).toBe(99.6)
  })

  it('describes the trade of a year or its average', () => {
    expect(describeTradeKg(171, false)).toBe('Købt 171 kg N')
    expect(describeTradeKg(-50, true)).toBe('Solgt gns. 50 kg N/år')
    expect(describeTradeKg(0, false)).toBe('Ingen handel i året')
    expect(describeTradeKg(0, true)).toBe('Ingen handel i gennemsnit')
  })

  it('marks the limit before the trade at the cap, or else the kvote', () => {
    // The original kvote of 100 kg N sits at 34 % of the bar's height.
    expect(quotaLimitLinePct(100, { capKgN: 150, tradeKg: -20 }, 34)).toBe(51)
    expect(quotaLimitLinePct(100, { capKgN: 50, tradeKg: 30 }, 34)).toBe(17)
    expect(quotaLimitLinePct(100, null, 34)).toBe(34)
    // Kept inside the bar area.
    expect(quotaLimitLinePct(100, { capKgN: 500, tradeKg: 0 }, 34)).toBe(100)
  })

  it('places the bought or sold kvote between the cap and the traded cap', () => {
    // The original kvote of 100 kg N sits at 34 % of the bar's height.
    const at = (capKgN: number, tradeKg: number) =>
      quotaTradeBand(100, { capKgN, tradeKg }, 34)
    expect(at(100, 50)).toEqual({
      kind: 'bought',
      bottomPct: 34,
      heightPct: 17,
    })
    expect(at(100, -25)).toEqual({
      kind: 'sold',
      bottomPct: 25.5,
      heightPct: 8.5,
    })
    // A cap under Grænser above or below the kvote is where the band starts.
    expect(at(150, -50)).toEqual({ kind: 'sold', bottomPct: 34, heightPct: 17 })
    expect(at(50, 25)).toEqual({
      kind: 'bought',
      bottomPct: 17,
      heightPct: 8.5,
    })
    // Kept inside the bar area, and nothing without a trade or a kvote.
    expect(at(100, 500)?.heightPct).toBe(66)
    expect(at(100, -150)).toMatchObject({ bottomPct: 0, heightPct: 34 })
    expect(at(100, 0)).toBeNull()
    expect(quotaTradeBand(0, { capKgN: 100, tradeKg: 50 }, 34)).toBeNull()
    expect(describeQuotaTradeAmount(225)).toBe('Købt kvote 225 kg N')
    expect(describeQuotaTradeAmount(-50)).toBe('Solgt kvote 50 kg N')
  })

  it('keeps the original quota as the default bar limit', () => {
    // 120 kg N against a kvote of 100 kg N drawn at 34 %.
    const over = quotaBarHeights(120, 100, 34)
    expect(over.heightPct).toBeCloseTo(40.8)
    expect(over.overPct).toBeCloseTo(100 / 6)
    expect(quotaBarHeights(100, 100, 34).overPct).toBe(0)
    expect(quotaBarHeights(80, 100, 34).overPct).toBe(0)
    expect(quotaBarHeights(80, 0, 34)).toEqual({ heightPct: 0, overPct: 0 })
  })

  it('keeps the bar height relative to the original quota after trading', () => {
    const bar = quotaBarHeights(120, 100, 34, 130)

    expect(bar.heightPct).toBeCloseTo(40.8)
  })

  it.each([
    [120, 130, 0],
    [140, 130, 100 / 14],
    [40, 70, 0],
    [80, 70, 12.5],
    [130, 130, 0],
    [1, 0, 100],
    [0, 0, 0],
    [10, -10, 100],
    [0, -10, 0],
  ])(
    'marks only the excess of %s kg above a limit of %s red',
    (load, limit, expected) => {
      const bar = quotaBarHeights(load, 100, 34, limit)

      expect(bar.overPct).toBeCloseTo(expected)
    },
  )

  it('clips a bar taller than the chart', () => {
    const bar = quotaBarHeights(400, 100, 50, 130)

    expect(bar).toEqual({ heightPct: 100, overPct: 35 })
  })

  it('clips a limit above the chart without drawing red', () => {
    const bar = quotaBarHeights(400, 100, 50, 500)

    expect(bar.overPct).toBe(0)
  })

  it('does not draw a traded bar without an original quota', () => {
    const bar = quotaBarHeights(80, 0, 34, 100)

    expect(bar).toEqual({ heightPct: 0, overPct: 0 })
  })

  it('shows the net trading contribution separately from crop DB2', () => {
    const totals = { db2: 100_000, economicsAreaHa: 10 } as FieldTotals

    const html = renderToStaticMarkup(
      createElement(QuotaTradeFigures, { trades: [buy, sell], totals }),
    )

    expect(html).toContain('Kvotehandel pr. år')
    expect(html).toContain('−2.425 kr i alt')
    expect(html).toContain('−243 kr/ha')
    expect(html).not.toContain('Kolding Fjord, indre')
  })

  it('omits the figure when no trades were saved', () => {
    const totals = { db2: 100_000, economicsAreaHa: 10 } as FieldTotals

    const html = renderToStaticMarkup(
      createElement(QuotaTradeFigures, { trades: [], totals }),
    )

    expect(html).toBe('')
  })

  it('shows sales income as a positive contribution', () => {
    const totals = { db2: 100_000, economicsAreaHa: 10 } as FieldTotals

    const html = renderToStaticMarkup(
      createElement(QuotaTradeFigures, { trades: [sell], totals }),
    )

    expect(html).toContain('+178 kr/ha')
    expect(html).toContain('+1.775 kr i alt')
  })

  it('shows the trading total without dividing by zero', () => {
    const totals = { db2: 0, economicsAreaHa: 0 } as FieldTotals

    const html = renderToStaticMarkup(
      createElement(QuotaTradeFigures, { trades: [sell], totals }),
    )

    expect(html).toContain('+1.775 kr i alt')
    expect(html).not.toContain('kr/ha')
  })
})

describe('DB2 including quota trades', () => {
  it.each([
    { name: 'sales income', trades: [sell], expected: 101_775 },
    { name: 'purchase costs', trades: [buy], expected: 95_800 },
    { name: 'trades across catchments', trades: [buy, sell], expected: 97_575 },
    { name: 'no trades', trades: [], expected: 100_000 },
  ])('includes $name in the annual result', ({ trades, expected }) => {
    const cropDb2 = 100_000

    const result = db2IncludingQuotaTrades(cropDb2, trades)

    expect(result).toBe(expected)
  })

  it.each([
    { year: ROTATION_CALENDAR_YEARS[0], expected: 101_200 },
    { year: ROTATION_CALENDAR_YEARS[1], expected: 95_800 },
  ])(
    'uses the quantity and direction-specific price for $year',
    ({ year, expected }) => {
      const trade = { ...buy, tradeKgByYear: byYear(-40, 120) }

      const result = db2IncludingQuotaTrades(100_000, [trade], year)

      expect(result).toBe(expected)
    },
  )

  it('uses the saved average when the calendar year is null', () => {
    const trade = {
      ...buy,
      tradeKgByYear: byYear(-40, 120),
      paymentDkkPerYear: 3_525,
    }

    const result = db2IncludingQuotaTrades(100_000, [trade], null)

    expect(result).toBe(96_475)
  })

  it('uses zero payment for a year with no saved trade', () => {
    const year = ROTATION_CALENDAR_YEARS[0] - 1

    const result = quotaTradePayment([buy], year)

    expect(result).toBe(0)
  })
})
