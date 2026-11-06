// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { QuotaTrade } from '@/api/types'
import type { CatchmentOption } from '@/components/farm/catchment-options'
import { RulesQuotaTrades } from '@/components/farm/RulesLimitsCard'

const catchments: CatchmentOption[] = [
  { catchmentId: 1, label: 'Limfjorden', colorClass: 'bg-blue-700' },
]

const trade = (
  catchmentId: number,
  buy: number,
  sell: number,
  sameEachYear?: boolean,
): QuotaTrade => ({
  catchmentId,
  buyPriceDkkPerKg: buy,
  sellPriceDkkPerKg: sell,
  sameEachYear,
})

describe('the chosen kvotehandel under Grænser', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const render = (quotaTrades: QuotaTrade[]) =>
    act(async () =>
      root.render(createElement(RulesQuotaTrades, { quotaTrades, catchments })),
    )

  it('names each traded opland with its prices', async () => {
    await render([trade(1, 35, 30, false), trade(7, 20, 20, false)])
    expect(container.textContent).toContain('Kvotehandel')
    expect(container.textContent).toContain(
      'Limfjordenkøb 35, salg 30 kr/kg N pr. år',
    )
    // An opland without a name of its own here keeps its number.
    expect(container.textContent).toContain('Kystvandopland 720 kr/kg N pr. år')
    expect(container.textContent).toContain(
      'Mængden kan være forskellig fra år til år.',
    )
    expect(container.textContent).toContain('Vælges i Års-optimering.')
  })

  it('says when the amount is the same in every year', async () => {
    // A trade saved before the setting existed is the same each year.
    await render([trade(1, 35, 30)])
    expect(container.textContent).toContain('Samme mængde i alle år.')
  })

  it('shows nothing without a kvotehandel', async () => {
    await render([])
    expect(container.textContent).toBe('')
  })
})
