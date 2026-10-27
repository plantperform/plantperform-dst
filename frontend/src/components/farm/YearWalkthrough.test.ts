// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FieldRecord, SimulationQuotaTrade } from '@/api/types'
import { YearWalkthrough } from '@/components/farm/YearWalkthrough'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { CatchmentTotalsByYear } from '@/lib/field-domain'

const field = (id: string, catchmentId: number, nLoad: number) =>
  ({
    id,
    catchmentId,
    quotaEligible: true,
    nLoadQuotaKgN: 100,
    nLoad,
    leaching: nLoad,
    db2: 1_000,
    feedUnits: 0,
    areaHa: 10,
    rotationId: 'rotation',
    cropRotation: [],
    allowedRotationIds: [],
  }) as unknown as FieldRecord

const trade = (catchmentId: number, tradeKg: number): SimulationQuotaTrade => ({
  catchmentId,
  catchmentName: null,
  tradeKg,
  priceDkkPerKg: 30,
  paymentDkkPerYear: 30 * tradeKg,
})

const yearTotals: CatchmentTotalsByYear = new Map([
  [1, { 1: { nLoadKg: 120, quotaKgN: 100, fieldCount: 1 } }],
  [2, { 1: { nLoadKg: 40, quotaKgN: 100, fieldCount: 1 } }],
])

describe('kvotehandel in the Årsgennemgang', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const render = (quotaTrades?: SimulationQuotaTrade[]) =>
    act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(YearWalkthrough, {
            entries: [
              {
                year: 1,
                totalNLoadKg: 160,
                totalDb2: 2_000,
                totalFeedUnits: 0,
                fieldCount: 2,
              },
            ],
            loading: false,
            fields: [field('a', 1, 120), field('b', 2, 40)],
            selectedYearIndex: null,
            onSelectedYearIndexChange: vi.fn(),
            catchmentLabel: (id) => `Opland ${id}`,
            catchmentColor: () => 'bg-blue-700',
            lastRun: null,
            collapsed: false,
            catchmentTotalsByYear: yearTotals,
            quotaTrades,
          }),
        ),
      ),
    )
  const bands = (className: string) =>
    container.querySelectorAll(`span.${className}`).length
  // The red top of a bar; the legend's swatch has more classes.
  const overParts = () =>
    container.querySelectorAll('span[class="bg-destructive"]').length
  const legend = () =>
    container.querySelector('section[aria-label="Gennemgang af årrække"]')
      ?.textContent ?? ''

  it('marks bought and sold kvote apart from the udledning and names them', async () => {
    await render([trade(1, 30), trade(2, -40)])
    expect(legend()).toContain('Oprindelig kvote')
    expect(legend()).toContain('Købt kvote')
    expect(legend()).toContain('Solgt kvote')
    // One band in the year's bar and one in the legend, for each kind.
    expect(bands('border-amber-500')).toBe(2)
    expect(bands('border-emerald-600')).toBe(2)
    // The kvote status still measures against the original kvote.
    expect(legend()).toContain('Over kvoten')
  })

  it('names only the kind of trade the run made', async () => {
    await render([trade(1, 30)])
    expect(legend()).toContain('Købt kvote')
    expect(legend()).not.toContain('Solgt kvote')
  })

  it('marks udledning red only over the limit after the trade', async () => {
    // Opland 1 lets out 120 kg N against a kvote of 100 kg N.
    await render([trade(1, 30)])
    expect(overParts()).toBe(0)
    await render([trade(1, 10)])
    expect(overParts()).toBe(1)
    // Opland 2 lets out 40 kg N, under its kvote but over 100 - 70 kg N.
    await render([trade(1, 30), trade(2, -70)])
    expect(overParts()).toBe(1)
  })

  it('stays as before without kvotehandel', async () => {
    await render()
    expect(legend()).not.toContain('Købt kvote')
    expect(legend()).not.toContain('Oprindelig kvote')
    expect(bands('border-amber-500')).toBe(0)
    expect(overParts()).toBe(1)
  })
})
