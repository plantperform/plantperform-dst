import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type {
  SavedResultView,
  Simulation,
  SimulationQuotaTrade,
} from '@/api/types'
import { fromWire } from '@/api/wire'
import { QuotaTradeFigures } from '@/components/farm/QuotaTradeFigures'
import { ROTATION_CALENDAR_YEARS, type FieldTotals } from '@/lib/field-domain'
import {
  describeQuotaPayment,
  describeQuotaTrade,
  describeQuotaTradeAmount,
  latestQuotaTrades,
  quotaBarHeights,
  quotaCapKgN,
  quotaLimitLinePct,
  quotaTradeBand,
  quotaTradeKgIn,
  quotaTradePayment,
  quotaTradeVaries,
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
  priceDkkPerKg: 35,
  sameEachYear: true,
  paymentDkkPerYear: 4_200,
}
const sell: SimulationQuotaTrade = {
  catchmentId: 2,
  catchmentName: null,
  tradeKgByYear: everyYear(-50),
  priceDkkPerKg: 35.5,
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
          priceKrPerKg: 35,
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
    expect(describeQuotaTrade(trade(-40, -100))).toBe(
      'Salg 40–100 kg N/år · 35 kr/kg N',
    )
    expect(describeQuotaTrade(trade(-40, 120))).toBe(
      'Køb op til 120 og salg op til 40 kg N/år · 35 kr/kg N',
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

  it('takes the cap a trade moves from Grænser, or else the kvote', () => {
    const [first, second] = ROTATION_CALENDAR_YEARS
    const caps = [
      { catchmentId: 1, maxNLoadByYear: { ...everyYear(337), [first]: 150 } },
    ]
    expect(quotaCapKgN(caps, 1, first, 336.7)).toBe(150)
    expect(quotaCapKgN(caps, 1, second, 336.7)).toBe(337)
    // The period's average cap.
    expect(quotaCapKgN(caps, 1, null, 336.7)).toBe((150 + 7 * 337) / 8)
    // No cap under Grænser: the kvote rounded to whole kg N, like the run.
    expect(quotaCapKgN(caps, 2, first, 99.6)).toBe(100)
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
    const totals = { db2: 100_000, calculatedAreaHa: 10 } as FieldTotals
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
