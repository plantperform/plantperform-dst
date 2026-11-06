import { describe, expect, it } from 'vitest'

import type { FieldRecord, OptimizationSettings } from '@/api/types'
import { fromWire, toWire } from '@/api/wire'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'
import {
  NO_QUOTA_TRADE_DRAFT,
  originalCapRange,
  quotaTradeBlock,
  quotaTradeDraftFrom,
  quotaTradeError,
  quotaTradesFrom,
} from '@/lib/quota-trade-settings'
import { DEFAULT_OPTIMIZATION_SETTINGS } from '@/lib/simulation-settings'

const field = (catchmentId: number | null, quotaEligible = true) =>
  ({ catchmentId, quotaEligible, nLoadQuotaKgN: 50.4 }) as FieldRecord

const everyYear = (value: number) =>
  Object.fromEntries(ROTATION_CALENDAR_YEARS.map((year) => [year, value]))

const yearly: OptimizationSettings = {
  ...DEFAULT_OPTIMIZATION_SETTINGS,
  kind: 'yearly',
  maxNLoadByCatchment: [
    { catchmentId: 1, maxNLoadByYear: { ...everyYear(100), 2028: 80 } },
  ],
}
const average: OptimizationSettings = { ...yearly, kind: 'optimize' }
const fields = [field(1), field(2), field(3, false), field(null)]

describe('kvotehandel settings', () => {
  it('names why a catchment cannot trade', () => {
    expect(quotaTradeBlock(1, fields, yearly)).toBeNull()
    // No saved yearly cap: the catchment's kvote holds in every year.
    expect(quotaTradeBlock(2, fields, yearly)).toBeNull()
    expect(quotaTradeBlock(3, fields, yearly)).toBe(
      'Ingen kvotegivende marker',
    )
    expect(quotaTradeBlock(null, fields, yearly)).toContain(
      'uden kystvandopland',
    )
    const withoutFirstYear = everyYear(100)
    delete withoutFirstYear[2027]
    expect(
      quotaTradeBlock(1, fields, {
        ...yearly,
        maxNLoadByCatchment: [
          { catchmentId: 1, maxNLoadByYear: withoutFirstYear },
        ],
      }),
    ).toBe('Kræver en grænse i alle år')
  })

  it('shows the caps a trade moves', () => {
    expect(originalCapRange(1, fields, yearly)).toEqual({ min: 80, max: 100 })
    expect(originalCapRange(2, fields, yearly)).toEqual({ min: 50, max: 50 })
    expect(originalCapRange(3, fields, yearly)).toBeUndefined()
  })

  it('saves the switched-on catchments that can trade, in the yearly optimization only', () => {
    const draft = {
      enabled: true,
      sameEachYear: true,
      catchments: {
        1: { enabled: true, buyPrice: '35,5', sellPrice: '30' },
        2: { enabled: false, buyPrice: '20', sellPrice: '' },
        3: { enabled: true, buyPrice: '10', sellPrice: '' },
      },
    }
    const saved = {
      catchmentId: 1,
      buyPriceDkkPerKg: 35.5,
      sellPriceDkkPerKg: 30,
    }
    expect(quotaTradesFrom(draft, yearly, fields)).toEqual([
      { ...saved, sameEachYear: true },
    ])
    expect(
      quotaTradesFrom({ ...draft, sameEachYear: false }, yearly, fields),
    ).toEqual([{ ...saved, sameEachYear: false }])
    expect(quotaTradesFrom(draft, average, fields)).toEqual([])
    expect(
      quotaTradesFrom({ ...draft, enabled: false }, yearly, fields),
    ).toEqual([])
  })

  it('sells at the buy price when no sell price is given', () => {
    const [trade] = quotaTradesFrom(
      {
        enabled: true,
        sameEachYear: true,
        catchments: { 1: { enabled: true, buyPrice: '35', sellPrice: ' ' } },
      },
      yearly,
      fields,
    )
    expect(trade).toMatchObject({ buyPriceDkkPerKg: 35, sellPriceDkkPerKg: 35 })
  })

  it('asks for a catchment and prices of at least 0, selling at most at the buy price', () => {
    expect(quotaTradeError(NO_QUOTA_TRADE_DRAFT, yearly, fields)).toBeNull()
    const draft = (buyPrice: string, sellPrice = '') => ({
      enabled: true,
      sameEachYear: true,
      catchments: { 1: { enabled: true, buyPrice, sellPrice } },
    })
    expect(
      quotaTradeError(
        { enabled: true, sameEachYear: true, catchments: {} },
        yearly,
        fields,
      ),
    ).toContain('Vælg mindst ét kystvandopland')
    for (const [buy, sell] of [
      ['', ''],
      ['-1', ''],
      ['abc', ''],
      ['30', '-1'],
      ['30', 'abc'],
    ])
      expect(quotaTradeError(draft(buy, sell), yearly, fields)).toContain(
        'Priserne skal være tal',
      )
    expect(quotaTradeError(draft('0'), yearly, fields)).toBeNull()
    expect(quotaTradeError(draft('30', '30'), yearly, fields)).toBeNull()
    expect(quotaTradeError(draft('30', '35'), yearly, fields)).toBe(
      'Salgsprisen må ikke være højere end købsprisen.',
    )
    // Only the yearly optimization trades, so nothing is asked otherwise.
    expect(quotaTradeError(draft(''), average, fields)).toBeNull()
  })

  it('opens saved trades as a draft and round trips them through the API names', () => {
    const trades = [
      {
        catchmentId: 1,
        buyPriceDkkPerKg: 35,
        sellPriceDkkPerKg: 30,
        sameEachYear: false,
      },
    ]
    expect(quotaTradeDraftFrom([])).toBe(NO_QUOTA_TRADE_DRAFT)
    const draft = quotaTradeDraftFrom(trades)
    expect(draft.sameEachYear).toBe(false)
    expect(quotaTradesFrom(draft, yearly, fields)).toEqual(trades)
    // Equal prices open with the sell price left to follow the buy price.
    expect(
      quotaTradeDraftFrom([{ ...trades[0], sellPriceDkkPerKg: 35 }])
        .catchments[1].sellPrice,
    ).toBe('')
    const settings = { ...yearly, quotaTrades: trades }
    expect(toWire(settings)).toMatchObject({
      quotaTrades: [
        {
          kystvandId: 1,
          buyPriceKrPerKg: 35,
          sellPriceKrPerKg: 30,
          sameEachYear: false,
        },
      ],
    })
    expect(fromWire(toWire(settings))).toEqual(settings)
  })

  it('opens trades saved before the choice as the same each year', () => {
    // A new kvotehandel chooses an amount for each year.
    expect(NO_QUOTA_TRADE_DRAFT.sameEachYear).toBe(false)
    expect(
      quotaTradeDraftFrom([
        { catchmentId: 1, buyPriceDkkPerKg: 35, sellPriceDkkPerKg: 35 },
      ]).sameEachYear,
    ).toBe(true)
  })
})
