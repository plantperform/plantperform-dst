// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CatchmentYearlyNLoadCaps,
  FieldRecord,
  OptimizeSimulationResponse,
  SimulationQuotaTrade,
  YearlySummaryEntry,
} from '@/api/types'
import { YearWalkthrough } from '@/components/farm/YearWalkthrough'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  ROTATION_CALENDAR_YEARS,
  REAL_HISTORY_START_CALENDAR_YEAR,
  type CatchmentTotalsByYear,
} from '@/lib/field-domain'

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

// laterKg: what the years after the first trade, when it differs. The
// payment is the average per year, each year at its direction's price, as a
// run reports it.
const trade = (
  catchmentId: number,
  tradeKg: number,
  laterKg = tradeKg,
  { buy, sell } = { buy: 30, sell: 30 },
): SimulationQuotaTrade => {
  const kgs = ROTATION_CALENDAR_YEARS.map((_, index) =>
    index === 0 ? tradeKg : laterKg,
  )
  return {
    catchmentId,
    catchmentName: null,
    tradeKgByYear: Object.fromEntries(
      ROTATION_CALENDAR_YEARS.map((year, index) => [year, kgs[index]]),
    ),
    buyPriceDkkPerKg: buy,
    sellPriceDkkPerKg: sell,
    sameEachYear: tradeKg === laterKg,
    paymentDkkPerYear:
      kgs.reduce((sum, kg) => sum + kg * (kg > 0 ? buy : sell), 0) / kgs.length,
  }
}

const yearTotals: CatchmentTotalsByYear = new Map([
  [1, { 1: { nLoadKg: 120, quotaKgN: 100, fieldCount: 1 } }],
  [2, { 1: { nLoadKg: 40, quotaKgN: 100, fieldCount: 1 } }],
])

const figures = (loads: number[], quotaKgN = 100, history = false) => {
  const average = loads.reduce((sum, load) => sum + load, 0) / loads.length
  const entries = loads.map((nLoad, index) => ({
    year: history ? REAL_HISTORY_START_CALENDAR_YEAR + index : index + 1,
    totalNLoadKg: nLoad,
    totalDb2: 1_000,
    totalFeedUnits: 0,
    fieldCount: 1,
  }))
  return {
    fields: [{ ...field('a', 1, average), nLoadQuotaKgN: quotaKgN }],
    entries,
    totalsByYear: new Map([
      [
        1,
        Object.fromEntries(
          entries.map((entry) => [
            entry.year,
            {
              nLoadKg: entry.totalNLoadKg,
              quotaKgN,
              fieldCount: 1,
            },
          ]),
        ),
      ],
    ]),
    history,
  }
}

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

  // year: the selected year's index, or null for all years. scoped: only
  // opland 1, as when it is picked.
  const render = (
    quotaTrades?: SimulationQuotaTrade[],
    quotaCaps?: CatchmentYearlyNLoadCaps[],
    {
      year = null,
      scoped = false,
      collapsed = false,
      lastRun = null,
      fields,
      totalsByYear = yearTotals,
      entries,
      history = false,
    }: {
      year?: number | null
      scoped?: boolean
      collapsed?: boolean
      lastRun?: OptimizeSimulationResponse | null
      fields?: FieldRecord[]
      totalsByYear?: CatchmentTotalsByYear
      entries?: YearlySummaryEntry[]
      history?: boolean
    } = {},
  ) =>
    act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(YearWalkthrough, {
            entries: entries ?? [
              {
                year: 1,
                totalNLoadKg: scoped ? 120 : 160,
                totalDb2: scoped ? 1_000 : 2_000,
                totalFeedUnits: 0,
                fieldCount: scoped ? 1 : 2,
              },
            ],
            loading: false,
            fields:
              fields ??
              (scoped
                ? [field('a', 1, 120)]
                : [field('a', 1, 120), field('b', 2, 40)]),
            selectedYearIndex: year,
            scopeLabel: scoped ? 'Opland 1' : null,
            onSelectedYearIndexChange: vi.fn(),
            catchmentLabel: (id) => `Opland ${id}`,
            catchmentColor: () => 'bg-blue-700',
            lastRun,
            collapsed,
            catchmentTotalsByYear: totalsByYear,
            history,
            quotaTrades,
            quotaCaps,
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
  const panel = () =>
    [...container.querySelectorAll('aside')]
      .map((aside) => aside.textContent)
      .join(' ')

  it('includes sales and purchase payments in the annual figure', async () => {
    const trades = [trade(1, 30), trade(2, -70)]

    await render(trades)

    expect(container.querySelector('[role="radio"]')?.textContent).toContain(
      'DB2 inkl. kvotehandel 3 t.kr',
    )
  })

  it.each([false, true])(
    'includes each year’s own payment in its accessible label (collapsed: %s)',
    async (collapsed) => {
      const trades = [trade(1, -100, 20, { buy: 30, sell: 20 })]

      await render(trades, undefined, { collapsed })

      expect(
        container.querySelector('[role="radio"]')?.getAttribute('aria-label'),
      ).toContain('2027: DB2 inkl. kvotehandel 4 t.kr')
    },
  )

  it('includes only the selected catchment’s payment in its annual figure', async () => {
    const trades = [trade(1, 30), trade(2, -70)]

    await render(trades, undefined, { scoped: true, year: 0 })

    expect(container.querySelector('[role="radio"]')?.textContent).toContain(
      'DB2 inkl. kvotehandel 100 kr',
    )
  })

  it('uses the selected year’s payment in the scoped summary', async () => {
    const trades = [trade(1, -100, 20, { buy: 30, sell: 20 }), trade(2, -70)]

    await render(trades, undefined, { scoped: true, year: 0 })

    expect(panel()).toContain('DB2 inkl. kvotehandel3 t.kr')
  })

  it('uses the saved average payment in the scoped period summary', async () => {
    const trades = [trade(1, -100, 20, { buy: 30, sell: 20 }), trade(2, -70)]

    await render(trades, undefined, { scoped: true })

    expect(panel()).toContain('DB2 gns. pr. år inkl. kvotehandel725 kr')
  })

  it('includes the last run’s own trades in its result', async () => {
    const lastRun = {
      status: 'OPTIMAL',
      objectiveDb2: 100_000,
      totalNLoadKg: 160,
      totalLeachingKg: 200,
      totalFeedUnits: 0,
      fields: [],
      assignments: [],
      quotaTrades: [trade(1, -100)],
    } satisfies OptimizeSimulationResponse

    await render([trade(1, 30)], undefined, { lastRun })

    expect(panel()).toContain('DB2 inkl. kvotehandel 103 t.kr')
  })

  it('keeps crop DB2 when no trades were saved', async () => {
    await render()

    expect(
      container.querySelector('[role="radio"]')?.getAttribute('aria-label'),
    ).toContain('2027: DB2 2 t.kr')
  })

  it('marks bought and sold kvote apart from the udledning and names them', async () => {
    await render([trade(1, 30), trade(2, -40)])
    expect(legend()).toContain('Oprindelig kvote')
    expect(legend()).toContain('Købt kvote')
    expect(legend()).toContain('Solgt kvote')
    // One band in the year's bar and one in the legend, for each kind.
    expect(bands('border-warning')).toBe(2)
    expect(bands('border-success')).toBe(2)
    expect(legend()).toContain('Over kvoten efter kvotehandel')
  })

  it('names only the kind of trade the run made', async () => {
    await render([trade(1, 30)])
    expect(legend()).toContain('Købt kvote')
    expect(legend()).not.toContain('Solgt kvote')
  })

  it('does not mark emissions covered by bought quota red', async () => {
    await render([trade(1, 30)])

    expect(overParts()).toBe(0)
  })

  it('marks emissions above the bought quota red', async () => {
    await render([trade(1, 10)])

    expect(overParts()).toBe(1)
  })

  it('marks emissions above the quota remaining after a sale red', async () => {
    await render([trade(1, 30), trade(2, -70)])

    expect(overParts()).toBe(1)
  })

  it('draws each year’s own trade when it differs between years', async () => {
    // The shown first year buys nothing; later years buy 30 kg N.
    await render([trade(1, 0, 30)])
    // The legend names the bought kvote, but the first year has no band.
    expect(legend()).toContain('Købt kvote')
    expect(bands('border-warning')).toBe(1)
    expect(overParts()).toBe(1)
    // The first year buys 30 kg N and later years sell.
    await render([trade(1, 30, -20)])
    expect(legend()).toContain('Solgt kvote')
    expect(bands('border-warning')).toBe(2)
    expect(overParts()).toBe(0)
  })

  // Opland 1's cap under Grænser in every year.
  const cap = (kg: number): CatchmentYearlyNLoadCaps[] => [
    {
      catchmentId: 1,
      maxNLoadByYear: Object.fromEntries(
        ROTATION_CALENDAR_YEARS.map((year) => [year, kg]),
      ),
    },
  ]
  const capLines = () =>
    [...container.querySelectorAll<HTMLElement>('span[data-cap-line]')].map(
      (line) => line.style.bottom,
    )

  // The band drawn in a bar, as a share of the kvote line's height; the
  // legend's swatch has no position.
  const drawnBand = (className: string) => {
    const kvoteLine = container.querySelector<HTMLElement>(
      'span.absolute.border-dashed',
    )
    const band = [
      ...container.querySelectorAll<HTMLElement>(`span.${className}`),
    ].find((span) => span.style.bottom !== '')
    const kvotePct = parseFloat(kvoteLine!.style.bottom)
    return {
      bottom: parseFloat(band!.style.bottom) / kvotePct,
      height: parseFloat(band!.style.height) / kvotePct,
    }
  }

  it('draws a trade from the cap under Grænser, the limit the run traded from', async () => {
    // Opland 1's cap of 150 kg N against its kvote of 100 kg N: 20 kg N sold
    // is drawn from 130 to 150 kg N.
    await render([trade(1, -20)], cap(150))
    const sold = drawnBand('border-success')
    expect(sold.bottom).toBeCloseTo(1.3)
    expect(sold.height).toBeCloseTo(0.2)
    // 30 kg N bought under a cap of 50 kg N is drawn from 50 to 80 kg N.
    await render([trade(1, 30)], cap(50))
    const bought = drawnBand('border-warning')
    expect(bought.bottom).toBeCloseTo(0.5)
    expect(bought.height).toBeCloseTo(0.3)
    // Without a cap, from the kvote.
    await render([trade(1, 30)])
    expect(drawnBand('border-warning').bottom).toBeCloseTo(1)
  })

  it('marks udledning red over the kvote, whatever the cap under Grænser', async () => {
    // Opland 1 lets out 120 kg N against a kvote of 100 kg N: red within a
    // cap of 150 kg N with only 10 kg N bought.
    await render([trade(1, 10)], cap(150))
    expect(overParts()).toBe(1)
    // Opland 2 lets out 40 kg N, under its kvote: not red, even over a cap
    // of 30 kg N. Only opland 1's bar is.
    await render(undefined, [
      {
        catchmentId: 2,
        maxNLoadByYear: Object.fromEntries(
          ROTATION_CALENDAR_YEARS.map((year) => [year, 30]),
        ),
      },
    ])
    expect(overParts()).toBe(1)
  })

  it('marks a cap under Grænser that differs from the kvote', async () => {
    // Opland 1's cap of 150 kg N sits at 1.5 times the height of its kvote
    // line; opland 2 has no cap of its own.
    await render(undefined, cap(150))
    const kvoteLine = container.querySelector<HTMLElement>(
      'span.absolute.border-dashed',
    )
    expect(capLines()).toHaveLength(1)
    expect(parseFloat(capLines()[0])).toBeCloseTo(
      1.5 * parseFloat(kvoteLine!.style.bottom),
    )
    expect(legend()).toContain('Loft under Grænser')
    // A cap equal to the kvote is not marked.
    await render(undefined, cap(100))
    expect(capLines()).toEqual([])
    expect(legend()).not.toContain('Loft under Grænser')
  })

  it('names each opland’s trade against its kvote for the whole farm', async () => {
    // Opland 2 trades nothing. Under its titled section, with its share of
    // the kvote after the row's own percentage; a cap does not change it.
    await render([trade(1, 30, 60)], cap(150))
    expect(panel()).toContain('KvotehandelKøbt gns. 56 kg N/år+56 %')
    // Opland 2 has no section.
    expect(panel().split('Kvotehandel').length - 1).toBe(1)
    // The selected first year buys 30 kg N of the 100 kg N kvote.
    await render([trade(1, 30, 60)], cap(150), { year: 0 })
    expect(panel()).toContain('KvotehandelKøbt 30 kg N+30 %')
    await render([trade(1, -30)], undefined, { year: 0 })
    expect(panel()).toContain('KvotehandelSolgt 30 kg N−30 %')
    // A year without a trade says so, with no share.
    await render([trade(1, 0, 30)], undefined, { year: 0 })
    expect(panel()).toContain('KvotehandelIngen handel i året')
    expect(panel()).not.toMatch(/[+−]\d+ %/)
  })

  it('shows one opland’s trade, its price and what it costs', async () => {
    await render([trade(1, 30, 60)], cap(150), { scoped: true, year: 0 })
    // The opland's own facts stay beside its trade, which covers the year.
    expect(panel()).toMatch(/Marker1 mark · 10 ha/)
    expect(panel()).toContain('År over kvoten0 af 1')
    expect(panel()).toContain('Kvote pr. ha')
    expect(panel()).toContain('Købt kvote30 kg N (+30 % af kvoten)')
    expect(panel()).toContain('Pris30 kr/kg N')
    // 30 kg N at 30 kr.
    expect(panel()).toContain('Udgift900 kr')
    // The period's average: seven years of 60 kg N and one of 30 kg N.
    await render([trade(1, 30, 60)], cap(150), { scoped: true })
    expect(panel()).toContain('Købt kvote gns. pr. år56 kg N')
    expect(panel()).toContain('Udgift gns. pr. år1.688 kr')
    // Selling earns.
    await render([trade(1, -30)], undefined, { scoped: true, year: 0 })
    expect(panel()).toContain('Indtægt900 kr')
  })

  it.each([
    [120, 30, '120 af 130 kg N efter kvotehandel, 10 kg N tilbage'],
    [140, 30, '140 af 130 kg N efter kvotehandel, skal ned med 10 kg N'],
    [40, -30, '40 af 70 kg N efter kvotehandel, 30 kg N tilbage'],
    [80, -30, '80 af 70 kg N efter kvotehandel, skal ned med 10 kg N'],
    [130, 30, '130 af 130 kg N efter kvotehandel, 0 kg N tilbage'],
    [0, -100, '0 af 0 kg N efter kvotehandel, 0 kg N tilbage'],
    [0, -110, '0 af -10 kg N efter kvotehandel, skal ned med 10 kg N'],
  ])(
    'shows the remaining quota for emissions %s and trade %s',
    async (load, kg, text) => {
      const data = figures([load])

      await render([trade(1, kg)], undefined, {
        ...data,
        scoped: true,
        year: 0,
      })

      expect(panel()).toContain(text)
    },
  )

  it.each([
    [120, 30, 'tæt på kvote efter kvotehandel'],
    [140, 30, 'over kvote efter kvotehandel'],
    [40, -30, 'under kvote efter kvotehandel'],
    [80, -30, 'over kvote efter kvotehandel'],
    [130, 30, 'tæt på kvote efter kvotehandel'],
    [0, -100, 'tæt på kvote efter kvotehandel'],
    [1, -100, 'over kvote efter kvotehandel'],
    [0, -110, 'over kvote efter kvotehandel'],
  ])('rates emissions %s after trading %s', async (load, kg, text) => {
    const data = figures([load])

    await render([trade(1, kg)], undefined, { ...data, scoped: true, year: 0 })

    expect(panel()).toContain(text)
  })

  it('keeps the scoped percentage relative to the original quota', async () => {
    await render([trade(1, 30)], undefined, { scoped: true, year: 0 })

    expect(panel()).toContain('120 % af oprindelig kvote')
  })

  it.each([50, 150])(
    'ignores a cap of %s when calculating remaining quota',
    async (limit) => {
      await render([trade(1, 30)], cap(limit), { scoped: true, year: 0 })

      expect(panel()).toContain(
        '120 af 130 kg N efter kvotehandel, 10 kg N tilbage',
      )
    },
  )

  it('uses the existing quota rounding for a trading catchment', async () => {
    const data = figures([130], 99.6)

    await render([trade(1, 30)], undefined, { ...data, scoped: true, year: 0 })

    expect(panel()).toContain('tæt på kvote efter kvotehandel')
  })

  it.each([
    [30, false],
    [10, true],
  ])('colours the whole-farm percentage after buying %s', async (kg, over) => {
    await render([trade(1, kg)], undefined, { year: 0 })

    const percent = [...container.querySelectorAll('aside span')].find(
      (span) => span.textContent === '120 % af oprindelig kvote',
    )
    expect(percent?.classList.contains('text-destructive')).toBe(over)
  })

  it('does not apply another catchment’s bought quota', async () => {
    await render([trade(2, 30)], undefined, { year: 0 })

    const percent = [...container.querySelectorAll('aside span')].find(
      (span) => span.textContent === '120 %',
    )
    expect(percent?.className).toContain('text-destructive')
  })

  it('shows the adjusted amount in the whole-farm row', async () => {
    await render([trade(2, -30)], undefined, { year: 0 })

    expect(panel()).toContain('40 af 70 kg N efter kvotehandel')
  })

  it.each([false, true])(
    'describes the year after trading (collapsed: %s)',
    async (collapsed) => {
      await render([trade(1, 30)], undefined, { collapsed, year: 0 })

      expect(
        container.querySelector('[role="radio"]')?.getAttribute('aria-label'),
      ).toContain('alle oplande under kvoten efter kvotehandel')
    },
  )

  it.each([
    [120, 30, false],
    [80, -30, true],
  ])(
    'colours the collapsed meter for emissions %s and trade %s',
    async (load, kg, over) => {
      const data = figures([load])

      await render([trade(1, kg)], undefined, {
        ...data,
        collapsed: true,
        year: 0,
      })

      expect(
        container
          .querySelector('span.block.h-full')
          ?.classList.contains('bg-destructive'),
      ).toBe(over)
    },
  )

  it('labels the original percentage and adjusted status when collapsed', async () => {
    await render([trade(1, 30)], undefined, {
      scoped: true,
      collapsed: true,
      year: 0,
    })

    expect(container.textContent).toContain(
      '120 % af oprindelig kvote tæt på kvote efter kvotehandel',
    )
  })

  it('counts years using each year’s own trade', async () => {
    const data = figures(ROTATION_CALENDAR_YEARS.map(() => 120))

    await render([trade(1, 30, 10)], undefined, { ...data, scoped: true })

    expect(panel()).toContain('År over kvoten7 af 8')
  })

  it('uses the average limit in the period summary', async () => {
    const data = figures(ROTATION_CALENDAR_YEARS.map(() => 120))

    await render([trade(1, 30, 10)], undefined, { ...data, scoped: true })

    expect(panel()).toContain(
      '120 af 113 kg N efter kvotehandel, skal ned med 8 kg N',
    )
  })

  it('counts a year made over quota by selling', async () => {
    const data = figures(ROTATION_CALENDAR_YEARS.map(() => 80))

    await render([trade(1, -30, 0)], undefined, { ...data, scoped: true })

    expect(panel()).toContain('År over kvoten1 af 8')
  })

  it.each([null, 0])(
    'preserves partial status after a covering purchase (year: %s)',
    async (year) => {
      const data = figures([120])
      data.fields.push({
        ...field('missing', 1, 0),
        rotationId: null,
        nLoadQuotaKgN: 0,
      })

      await render([trade(1, 30)], undefined, { ...data, scoped: true, year })

      expect(panel()).toContain('delvist beregnet')
    },
  )

  it.each([null, 0])(
    'reports a known overrun despite missing fields (year: %s)',
    async (year) => {
      const data = figures([80])
      data.fields.push({
        ...field('missing', 1, 0),
        rotationId: null,
        nLoadQuotaKgN: 0,
      })

      await render([trade(1, -30)], undefined, { ...data, scoped: true, year })

      expect(panel()).toContain('over kvote efter kvotehandel')
    },
  )

  it('preserves the uncalculated state when a year has no field values', async () => {
    await render([trade(1, 30)], undefined, {
      totalsByYear: new Map(),
      scoped: true,
      year: 0,
    })

    expect(panel()).toContain('ikke beregnet')
  })

  it('does not create a quota by trading when the original quota is zero', async () => {
    const data = figures([120], 0)

    await render([trade(1, 130)], undefined, { ...data, scoped: true, year: 0 })

    expect(panel()).toContain('ingen kvote')
  })

  it.each([null, 0])(
    'ignores trades in the historical panel (year: %s)',
    async (year) => {
      const data = figures([120], 100, true)

      await render([trade(1, 30)], cap(150), { ...data, scoped: true, year })

      expect(panel()).toContain('120 af 100 kg N, skal ned med 20 kg N')
    },
  )

  it('ignores trades in historical bars', async () => {
    const data = figures([120], 100, true)

    await render([trade(1, 30)], undefined, data)

    expect(overParts()).toBe(1)
  })

  it('prices each year at its direction and averages what the run paid', async () => {
    const prices = { buy: 30, sell: 20 }
    // A year that sells 30 kg N at 20 kr, and one that buys 60 kg N at 30 kr.
    await render([trade(1, -30, 60, prices)], cap(150), {
      scoped: true,
      year: 0,
    })
    expect(panel()).toContain('Pris20 kr/kg N')
    expect(panel()).toContain('Indtægt600 kr')
    await render([trade(1, 60, -30, prices)], cap(150), {
      scoped: true,
      year: 0,
    })
    expect(panel()).toContain('Pris30 kr/kg N')
    expect(panel()).toContain('Udgift1.800 kr')
    // The first year sells and the other seven buy.
    // (7 * 1.800 - 600) / 8 kr, at both prices.
    await render([trade(1, -30, 60, prices)], cap(150), { scoped: true })
    expect(panel()).toContain('Priskøb 30, salg 20 kr/kg N')
    expect(panel()).toContain('Udgift gns. pr. år1.500 kr')
  })

  it('measures each year against the kvote and shows a different cap beside it', async () => {
    // Opland 1 lets out 120 kg N: over its kvote of 100 kg N, though within
    // a cap of 150 kg N set for the year. The cap does not hide it.
    await render(undefined, cap(150), { year: 0 })
    expect(panel()).toContain('120 af 100 kg N')
    expect(panel()).toContain('120 %')
    expect(overParts()).toBe(1)
    // Picked on its own: over the kvote, with the cap named as information.
    await render(undefined, cap(150), { year: 0, scoped: true })
    expect(panel()).toContain('120 %over kvote')
    expect(panel()).toContain('skal ned med 20 kg N')
    expect(panel()).toContain('Loft under Grænser: 150 kg N')
    // A lower cap changes nothing but the information.
    await render(undefined, cap(60), { year: 0, scoped: true })
    expect(panel()).toContain('skal ned med 20 kg N')
    expect(panel()).toContain('Loft under Grænser: 60 kg N')
    // A cap equal to the kvote is not mentioned.
    await render(undefined, cap(100), { year: 0, scoped: true })
    expect(panel()).not.toContain('Loft under Grænser')
  })

  it('stays as before without kvotehandel', async () => {
    await render()
    expect(legend()).not.toContain('Købt kvote')
    expect(legend()).not.toContain('Oprindelig kvote')
    expect(capLines()).toEqual([])
    expect(bands('border-warning')).toBe(0)
    expect(overParts()).toBe(1)
    // A single opland keeps its Marker and År over kvoten.
    await render(undefined, undefined, { scoped: true })
    expect(panel()).toMatch(/Marker1 mark · 10 ha/)
    expect(panel()).toContain('År over kvoten1 af 1')
  })
})
