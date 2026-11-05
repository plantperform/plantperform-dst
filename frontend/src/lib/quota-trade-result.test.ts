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
  describeQuotaPayment,
  describeQuotaTrade,
  describeQuotaTradeAmount,
  describeTradeKg,
  describeTradePrices,
  formatTradeShareOfCap,
  latestQuotaTrades,
  quotaBarHeights,
  quotaLimitLinePct,
  quotaTradeBand,
  quotaTradeKgIn,
  quotaTradePayment,
  quotaTradeVaries,
  tradePriceDkkPerKg,
  describeAfterTrade,
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
    expect(describeQuotaPayment(4_200)).toBe('Betaler 4.200 kr/år')
    expect(describeQuotaPayment(-1_775)).toBe('Modtager 1.775 kr/år')
    expect(describeQuotaPayment(4_200, true)).toBe('Betaler gns. 4.200 kr/år')
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
    expect(describeAfterTrade(30)).toBe('efter køb')
    expect(describeAfterTrade(-30)).toBe('efter salg')
    expect(describeAfterTrade(0)).toBe('')
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

  it('describes a trade against the cap it moved', () => {
    expect(formatTradeShareOfCap({ capKgN: 150, tradeKg: 171 })).toBe('+114 %')
    expect(formatTradeShareOfCap({ capKgN: 450, tradeKg: -119 })).toBe('−26 %')
    expect(formatTradeShareOfCap({ capKgN: 0, tradeKg: 20 })).toBeNull()
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

  it('marks udledning over the limit after the trade, not over the original kvote', () => {
    const over = (nLoadKg: number, capKgN: number, tradeKg: number) =>
      quotaBarHeights(nLoadKg, 100, { capKgN, tradeKg }, 34).overPct
    // 120 kg N against a kvote of 100 kg N drawn at 34 %, without a trade.
    expect(quotaBarHeights(120, 100, null, 34).overPct).toBeCloseTo(100 / 6)
    // Bought kvote covers it entirely, or partly.
    expect(quotaBarHeights(120, 100, { capKgN: 100, tradeKg: 30 }, 34)).toEqual(
      { heightPct: 40.8, overPct: 0 },
    )
    expect(over(120, 100, 10)).toBeCloseTo(100 / 12)
    // Selling lowers the limit below the original kvote.
    expect(over(90, 100, -20)).toBeCloseTo(100 / 9)
    expect(over(80, 100, -20)).toBe(0)
    // The limit is the cap under Grænser moved by the trade, not the kvote:
    // 330 kg N is within a cap of 450 kg N less 119 kg N sold.
    expect(
      quotaBarHeights(330, 337, { capKgN: 450, tradeKg: -119 }, 34).overPct,
    ).toBe(0)
    // And 320 kg N is over a cap of 150 kg N with only 100 kg N bought.
    expect(
      quotaBarHeights(320, 337, { capKgN: 150, tradeKg: 100 }, 34).overPct,
    ).toBeGreaterThan(0)
    expect(quotaBarHeights(80, 0, { capKgN: 0, tradeKg: 20 }, 34)).toEqual({
      heightPct: 0,
      overPct: 0,
    })
  })

  it('takes the payments off the crops’ DB2 on the card', () => {
    const totals = { db2: 100_000, economicsAreaHa: 10 } as FieldTotals
    const html = renderToStaticMarkup(
      createElement(QuotaTradeFigures, {
        trades: [buy, sell],
        totals,
        catchmentLabel: (id) => `Kystvandopland ${id}`,
      }),
    )
    expect(html).toContain('Dækningsbidrag inkl. kvotehandel')
    // 100.000 kr less 2.425 kr in payments, over 10 ha.
    expect(html).toContain('98 t.kr i alt')
    expect(html).toContain('9.758')
    expect(html).toContain('Kolding Fjord, indre')
    expect(html).toContain('Kystvandopland 2')
    expect(html).toContain('Modtager 1.775 kr/år')
    // A payment that differs between years is shown as its average.
    expect(
      renderToStaticMarkup(
        createElement(QuotaTradeFigures, {
          trades: [{ ...buy, tradeKgByYear: byYear(-40, 120) }],
          totals,
          catchmentLabel: String,
        }),
      ),
    ).toContain('Betaler gns. 4.200 kr/år')
    expect(
      renderToStaticMarkup(
        createElement(QuotaTradeFigures, {
          trades: [],
          totals,
          catchmentLabel: String,
        }),
      ),
    ).toBe('')
  })
})
