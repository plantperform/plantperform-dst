// @vitest-environment jsdom

import type { VirtualizerOptions } from '@tanstack/react-virtual'
import { act, createElement, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FieldRecord, SimulationQuotaTrade } from '@/api/types'
import { FarmFieldsList } from '@/components/farm/FarmFieldsList'
import { TooltipProvider } from '@/components/ui/tooltip'
import { emptyMeasures, ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'

type VirtualOptions = VirtualizerOptions<Element, Element>
const viewport = vi.hoisted(() => {
  document.documentElement.style.fontSize = '16px'
  return {
    start: 0,
    end: Infinity,
    options: undefined as VirtualOptions | undefined,
    scrollToIndex: vi.fn(),
  }
})

vi.mock('@/api/hooks', () => ({ useFarmFields: () => ({ data: [] }) }))
vi.mock('@/lib/text-width', () => ({
  textWidth: (text: string) => text.length,
}))
vi.mock('@/components/ui/app-tooltip', () => ({
  AppTooltip: ({
    content,
    children,
  }: {
    content: string
    children: ReactNode
  }) => createElement('span', { title: content ?? undefined }, children),
  TruncatedTooltip: ({
    content,
    children,
  }: {
    content: string
    children: ReactNode
  }) => createElement('span', { title: content }, children),
}))
// Control the viewport while keeping the real table, row model and range extractor.
vi.mock('@tanstack/react-virtual', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-virtual')>()),
  useVirtualizer: (options: VirtualOptions) => {
    viewport.options = options
    return {
      measure: () => {},
      scrollToIndex: viewport.scrollToIndex,
      getTotalSize: () =>
        Array.from({ length: options.count }, (_, index) =>
          options.estimateSize(index),
        ).reduce((sum, size) => sum + size, 0),
      getVirtualItems: () => {
        const indexes = options.rangeExtractor!({
          startIndex: viewport.start,
          endIndex: Math.min(viewport.end, options.count - 1),
          overscan: 0,
          count: options.count,
        })
        let start = options.scrollMargin ?? 0
        return Array.from({ length: options.count }, (_, index) => {
          const size = options.estimateSize(index)
          const item = {
            index,
            start,
            end: start + size,
            size,
            key: options.getItemKey!(index),
            lane: 0,
          }
          start += size
          return item
        }).filter((item) => indexes.includes(item.index))
      },
    }
  },
}))

const field = (
  id = 'a',
  catchmentId = 1,
  overrides: Partial<FieldRecord> = {},
): FieldRecord => ({
  id,
  catchmentId,
  name: id,
  farmId: 'farm',
  imkId: null,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId: 'rotation',
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 100_000,
  nLoad: 100,
  leaching: 100,
  feedUnits: 0,
  areaHa: 10,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 200,
  quotaEligible: true,
  geometry: null,
  ...overrides,
})

const trade = (
  catchmentId = 1,
  kg = -100,
  laterKg = kg,
): SimulationQuotaTrade => {
  const amounts = ROTATION_CALENDAR_YEARS.map((_, index) =>
    index === 0 ? kg : laterKg,
  )
  return {
    catchmentId,
    catchmentName: null,
    tradeKgByYear: Object.fromEntries(
      ROTATION_CALENDAR_YEARS.map((year, index) => [year, amounts[index]]),
    ),
    buyPriceDkkPerKg: 50,
    sellPriceDkkPerKg: 50,
    paymentDkkPerYear:
      amounts.reduce((sum, amount) => sum + amount * 50, 0) / amounts.length,
    sameEachYear: kg === laterKg,
  }
}

describe('quota trading in the field list', () => {
  let root: Root
  let container: HTMLDivElement
  let props: ComponentProps<typeof FarmFieldsList>

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    viewport.start = 0
    viewport.end = Infinity
    viewport.scrollToIndex.mockClear()
    window.localStorage.clear()
    HTMLElement.prototype.scrollTo = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return {
          width: this.tagName === 'TABLE' ? 800 : 300,
          height: 40,
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 300,
          bottom: 40,
          toJSON: () => ({}),
        }
      },
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    props = {
      farmId: 'farm',
      sortedFields: [field()],
      quotaTrades: [trade()],
      isSimulationView: true,
      rotationNames: new Map(),
      sort: { key: 'name', direction: 'asc' },
      onSortChange: vi.fn(),
      selectedFieldId: null,
      onSelectedFieldChange: vi.fn(),
      hoveredFieldId: null,
      onHoveredFieldChange: vi.fn(),
      highlightedCatchmentKey: null,
      catchmentLabel: (id) => `Opland ${id}`,
      catchmentColor: () => 'bg-blue-700',
      onHighlightedCatchmentKeyChange: vi.fn(),
      detachingFieldIds: [],
      onRequestDetach: vi.fn(),
      paneWidth: 300,
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const render = () =>
    act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(FarmFieldsList, props),
        ),
      ),
    )
  const tradingRow = (id = 1) =>
    container.querySelector<HTMLTableRowElement>(
      `tr[aria-label="Kvotehandel for Opland ${id}"]`,
    )
  const footer = () => container.querySelector('tfoot')!
  const cellText = (row: Element, heading: string) => {
    const headers = [...container.querySelectorAll('thead th')]
    const index = headers.findIndex((header) =>
      header.textContent?.startsWith(heading),
    )
    return row.querySelectorAll('td')[index]?.textContent
  }

  it('places the trading row after the catchment’s fields', async () => {
    props.sortedFields = [field('a'), field('b'), field('c', 2)]
    props.quotaTrades = [trade(1), trade(2)]

    await render()

    expect(
      [...container.querySelectorAll('tbody tr[aria-label]')].map((row) =>
        row.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Kystvandopland Opland 1',
      'Vis detaljer for mark a',
      'Vis detaljer for mark b',
      'Kvotehandel for Opland 1',
      'Kystvandopland Opland 2',
      'Vis detaljer for mark c',
      'Kvotehandel for Opland 2',
    ])
  })

  it('shows the signed trading rate and total in compact mode', async () => {
    await render()

    expect(cellText(tradingRow()!, 'DB2')).toBe('+500 kr/ha+5.000 kr i alt')
    expect(
      tradingRow()!.querySelector('td.text-right .text-xs')?.className,
    ).not.toContain('hidden')
  })

  it('includes the trade once in the net DB2 footer', async () => {
    await render()

    expect(cellText(footer(), 'DB2')).toBe('10.500 kr/ha105.000 kr i alt')
  })

  it('keeps the field’s own DB2 unchanged', async () => {
    await render()

    expect(
      cellText(
        container.querySelector('tr[aria-label="Vis detaljer for mark a"]')!,
        'DB2',
      ),
    ).toBe('10.000 kr/ha100.000 kr i alt')
  })

  it('does not add the trade to the area or field counts', async () => {
    await render()

    expect(cellText(footer(), 'Areal')).toBe('10 ha')
    expect(
      container.querySelector('tr[aria-label="Kystvandopland Opland 1"]')
        ?.textContent,
    ).toContain('1 mark · 10 ha')
  })

  it('keeps trade rows free of nonfinancial values and field actions', async () => {
    await render()

    const row = tradingRow()!
    expect(
      [...row.querySelectorAll('td')]
        .filter((cell) => cell.textContent !== '')
        .map((cell) => cell.textContent),
    ).toEqual(['Kvotehandel', '+500 kr/ha+5.000 kr i alt'])
    expect(row.querySelector('button')).toBeNull()
  })

  it('does not select a field when the trade row is clicked', async () => {
    await render()

    await act(async () => tradingRow()!.click())

    expect(props.onSelectedFieldChange).not.toHaveBeenCalled()
  })

  it('shows a negative contribution for quota purchases', async () => {
    props.quotaTrades = [trade(1, 100)]

    await render()

    expect(cellText(tradingRow()!, 'DB2')).toBe('−500 kr/ha−5.000 kr i alt')
  })

  it('uses each catchment’s own economics area for its rate', async () => {
    props.sortedFields = [field(), field('b', 2, { areaHa: 20 })]
    props.quotaTrades = [trade(1), trade(2, 100)]

    await render()

    expect(cellText(tradingRow(2)!, 'DB2')).toBe('−250 kr/ha−5.000 kr i alt')
  })

  it('nets sales and purchases from different catchments in the footer', async () => {
    props.sortedFields = [field(), field('b', 2, { areaHa: 20 })]
    props.quotaTrades = [trade(1), trade(2, 100)]

    await render()

    expect(cellText(footer(), 'DB2')).toBe('6.667 kr/ha200.000 kr i alt')
  })

  it('explains the economics area and trade details on hover', async () => {
    await render()

    expect(
      tradingRow()!.querySelector('[title]')?.getAttribute('title'),
    ).toContain(
      'Gennemsnit pr. år: Salg 100 kg N/år · 50 kr/kg N. Pr. ha er fordelt på oplandets 10 ha med økonomiberegning.',
    )
  })

  it('explains that the DB2 footer includes trading on hover', async () => {
    await render()

    expect(
      footer().querySelector('[title="DB2 inkl. kvotehandel"]'),
    ).not.toBeNull()
  })

  it('uses the selected year’s payment for both the row and footer', async () => {
    props.quotaTrades = [trade(1, -100, 20)]
    props.selectedYearIndex = 1
    props.yearValues = {}

    await render()

    expect(cellText(tradingRow()!, 'DB2')).toBe('−100 kr/ha−1.000 kr i alt')
    expect(cellText(footer(), 'DB2')).toBe('9.900 kr/ha99.000 kr i alt')
  })

  it('uses the saved annual average when all years are selected', async () => {
    props.quotaTrades = [trade(1, -100, 20)]

    await render()

    expect(cellText(tradingRow()!, 'DB2')).toBe('−25 kr/ha−250 kr i alt')
  })

  it('keeps the row when the selected year has no trade', async () => {
    props.quotaTrades = [trade(1, 0, 20)]
    props.selectedYearIndex = 0
    props.yearValues = {}

    await render()

    expect(cellText(tradingRow()!, 'DB2')).toBe('±0 kr/ha±0 kr i alt')
  })

  it('shows a pending footer while the selected year’s values are loading', async () => {
    props.selectedYearIndex = 0
    props.yearValuesLoading = true

    await render()

    expect(
      footer().querySelector('[aria-label="Henter årets DB2"]'),
    ).not.toBeNull()
    expect(footer().textContent).not.toContain('105.000 kr')
  })

  it('keeps the trading total without dividing by missing economics area', async () => {
    props.sortedFields = [field('a', 1, { economicsMissing: true, db2: 0 })]

    await render()

    expect(cellText(tradingRow()!, 'DB2')).toBe('+5.000 kr i alt')
    expect(cellText(footer(), 'DB2')).toBe('5.000 kr')
  })

  it('excludes fields without economics from the trading rate’s area', async () => {
    props.sortedFields = [
      field(),
      field('b', 1, { economicsMissing: true, areaHa: 20, db2: 0 }),
    ]

    await render()

    expect(cellText(tradingRow()!, 'DB2')).toBe('+500 kr/ha+5.000 kr i alt')
  })

  it('hides trading rows when the DB2 column is hidden', async () => {
    window.localStorage.setItem(
      'plantperform.farmColumns.simulation',
      JSON.stringify({ db2: false }),
    )

    await render()

    expect(tradingRow()).toBeNull()
  })

  it('leaves historical lists without trading rows', async () => {
    props.isSimulationView = false

    await render()

    expect(tradingRow()).toBeNull()
  })

  it('leaves legacy results without trading rows or adjusted totals', async () => {
    props.quotaTrades = undefined

    await render()

    expect(tradingRow()).toBeNull()
    expect(cellText(footer(), 'DB2')).toBe('10.000 kr/ha100.000 kr i alt')
  })

  it('dims other catchments’ trading rows without narrowing the footer', async () => {
    props.sortedFields = [field(), field('b', 2)]
    props.quotaTrades = [trade(1), trade(2)]
    props.highlightedCatchmentKey = '1'

    await render()

    expect(tradingRow(2)!.className).toContain('opacity-50')
    expect(cellText(footer(), 'DB2')).toBe('10.500 kr/ha210.000 kr i alt')
  })

  it('measures trade content even when its row is outside the virtual window', async () => {
    props.sortedFields = Array.from({ length: 50 }, (_, index) =>
      field(`field-${index}`),
    )
    viewport.end = 4

    await render()

    expect(tradingRow()).toBeNull()
    expect(
      container.querySelector('tbody[aria-hidden="true"]')?.textContent,
    ).toContain('Kvotehandel+10 kr/ha+5.000 kr i alt')
  })

  it('reserves two lines for a virtual trade row in compact mode', async () => {
    await render()

    expect(viewport.options!.estimateSize(2)).toBe(52)
    expect(tradingRow()!.style.height).toBe('52px')
  })

  it('scrolls to the correct field after a trade row has been inserted', async () => {
    props.sortedFields = [field(), field('b', 2)]
    props.selectedFieldId = 'b'

    await render()

    expect(viewport.scrollToIndex).toHaveBeenCalledWith(4)
  })
})
