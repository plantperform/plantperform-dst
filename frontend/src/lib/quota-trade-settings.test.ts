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
    ).toBe('Ikke grænse i alle år')
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
        1: { enabled: true, price: '35,5' },
        2: { enabled: false, price: '20' },
        3: { enabled: true, price: '10' },
      },
    }
    expect(quotaTradesFrom(draft, yearly, fields)).toEqual([
      { catchmentId: 1, priceDkkPerKg: 35.5, sameEachYear: true },
    ])
    expect(
      quotaTradesFrom({ ...draft, sameEachYear: false }, yearly, fields),
    ).toEqual([{ catchmentId: 1, priceDkkPerKg: 35.5, sameEachYear: false }])
    expect(quotaTradesFrom(draft, average, fields)).toEqual([])
    expect(
      quotaTradesFrom({ ...draft, enabled: false }, yearly, fields),
    ).toEqual([])
  })

  it('asks for a catchment and a price of at least 0', () => {
    expect(quotaTradeError(NO_QUOTA_TRADE_DRAFT, yearly, fields)).toBeNull()
    const draft = (price: string) => ({
      enabled: true,
      sameEachYear: true,
      catchments: { 1: { enabled: true, price } },
    })
    expect(
      quotaTradeError(
        { enabled: true, sameEachYear: true, catchments: {} },
        yearly,
        fields,
      ),
    ).toContain('Vælg mindst ét kystvandopland')
    for (const price of ['', '-1', 'abc'])
      expect(quotaTradeError(draft(price), yearly, fields)).toContain(
        'Prisen skal være et tal',
      )
    expect(quotaTradeError(draft('0'), yearly, fields)).toBeNull()
    // Only the yearly optimization trades, so nothing is asked otherwise.
    expect(quotaTradeError(draft(''), average, fields)).toBeNull()
  })

  it('opens saved trades as a draft and round trips them through the API names', () => {
    const trades = [{ catchmentId: 1, priceDkkPerKg: 35, sameEachYear: false }]
    expect(quotaTradeDraftFrom([])).toBe(NO_QUOTA_TRADE_DRAFT)
    const draft = quotaTradeDraftFrom(trades)
    expect(draft.sameEachYear).toBe(false)
    expect(quotaTradesFrom(draft, yearly, fields)).toEqual(trades)
    const settings = { ...yearly, quotaTrades: trades }
    expect(toWire(settings)).toMatchObject({
      quotaTrades: [{ kystvandId: 1, priceKrPerKg: 35, sameEachYear: false }],
    })
    expect(fromWire(toWire(settings))).toEqual(settings)
  })

  it('opens trades saved before the choice as the same each year', () => {
    expect(
      quotaTradeDraftFrom([{ catchmentId: 1, priceDkkPerKg: 35 }]).sameEachYear,
    ).toBe(true)
  })
})
