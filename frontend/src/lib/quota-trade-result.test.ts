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
import type { FieldTotals } from '@/lib/field-domain'
import {
  describeQuotaPayment,
  describeQuotaTrade,
  describeQuotaTradeAmount,
  latestQuotaTrades,
  quotaBarHeights,
  quotaTradeBand,
  quotaTradePayment,
} from '@/lib/quota-trade-result'

const buy: SimulationQuotaTrade = {
  catchmentId: 1,
  catchmentName: 'Kolding Fjord, indre',
  tradeKg: 120,
  priceDkkPerKg: 35,
  paymentDkkPerYear: 4_200,
}
const sell: SimulationQuotaTrade = {
  catchmentId: 2,
  catchmentName: null,
  tradeKg: -50,
  priceDkkPerKg: 35.5,
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
          tradeKg: 120,
          priceKrPerKg: 35,
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
    expect(describeQuotaTrade({ ...buy, tradeKg: 0 })).toBe('Ingen handel')
    expect(quotaTradePayment([buy, sell])).toBe(2_425)
    expect(describeQuotaPayment(4_200)).toBe('Betaler 4.200 kr/år')
    expect(describeQuotaPayment(-1_775)).toBe('Modtager 1.775 kr/år')
  })

  it('places the bought or sold kvote between the original and the traded kvote', () => {
    // The original kvote of 100 kg N sits at 34 % of the bar's height.
    expect(quotaTradeBand(100, 50, 34)).toEqual({
      kind: 'bought',
      bottomPct: 34,
      heightPct: 17,
    })
    expect(quotaTradeBand(100, -25, 34)).toEqual({
      kind: 'sold',
      bottomPct: 25.5,
      heightPct: 8.5,
    })
    // Kept inside the bar area, and nothing without a trade or a kvote.
    expect(quotaTradeBand(100, 500, 34)?.heightPct).toBe(66)
    expect(quotaTradeBand(100, -150, 34)).toMatchObject({
      bottomPct: 0,
      heightPct: 34,
    })
    expect(quotaTradeBand(100, 0, 34)).toBeNull()
    expect(quotaTradeBand(0, 50, 34)).toBeNull()
    expect(describeQuotaTradeAmount(225)).toBe('Købt kvote 225 kg N')
    expect(describeQuotaTradeAmount(-50)).toBe('Solgt kvote 50 kg N')
  })

  it('marks udledning over the limit after the trade, not over the original kvote', () => {
    // 120 kg N against a kvote of 100 kg N drawn at 34 %.
    expect(quotaBarHeights(120, 100, 0, 34).overPct).toBeCloseTo(100 / 6)
    // Bought kvote covers it entirely, or partly.
    expect(quotaBarHeights(120, 100, 30, 34)).toEqual({
      heightPct: 40.8,
      overPct: 0,
    })
    expect(quotaBarHeights(120, 100, 10, 34).overPct).toBeCloseTo(100 / 12)
    // Selling lowers the limit below the original kvote.
    expect(quotaBarHeights(90, 100, -20, 34).overPct).toBeCloseTo(100 / 9)
    expect(quotaBarHeights(80, 100, -20, 34).overPct).toBe(0)
    // The run's limit is the kvote rounded to whole kg N plus the trade, so
    // udledning up to it is not over a kvote that rounds up.
    expect(quotaBarHeights(124.9, 99.6, 25, 34).overPct).toBe(0)
    expect(quotaBarHeights(80, 0, 20, 34)).toEqual({
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
