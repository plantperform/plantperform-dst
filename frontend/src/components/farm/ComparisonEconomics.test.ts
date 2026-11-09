// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EconomicsStatement, SimulationQuotaTrade } from '@/api/types'
import { ComparisonEconomics } from '@/components/farm/ComparisonEconomics'
import type { ComparedColumn } from '@/components/farm/comparison-column'
import { STANDARD_PROFILE } from '@/lib/economics-profiles'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'

vi.mock('@/api/economics', () => ({
  useFarmBudgets: () => ({ data: undefined }),
}))
vi.mock('@/components/farm/economics-profiles-state', () => ({
  useEconomicsProfiles: () => ({ farmId: 'farm' }),
}))
vi.mock('@/components/farm/EconomicsChip', () => ({
  EconomicsChip: () => null,
}))

const statement: EconomicsStatement = {
  areaHa: 40,
  revenue: 600_000,
  subsidy: 40_000,
  fertiliserCost: 100_000,
  otherFertilisers: 0,
  seed: 30_000,
  cropProtection: 50_000,
  fieldWork: 120_000,
  drying: 10_000,
  other: 0,
  totalCosts: 310_000,
  db: 330_000,
}

// 200 kg N bought at 40 kr in every year: 8.000 kr a year.
const bought: SimulationQuotaTrade = {
  catchmentId: 1,
  catchmentName: null,
  tradeKgByYear: Object.fromEntries(
    ROTATION_CALENDAR_YEARS.map((year) => [year, 200]),
  ),
  buyPriceDkkPerKg: 40,
  sellPriceDkkPerKg: 30,
  sameEachYear: true,
  paymentDkkPerYear: 8_000,
}

const column = (key: string, quotaTrades: SimulationQuotaTrade[]) =>
  ({ key, title: key, history: false, quotaTrades }) as ComparedColumn

const view = (columns: ComparedColumn[]) =>
  createElement(
    MemoryRouter,
    null,
    createElement(ComparisonEconomics, {
      columns,
      highlightedKey: null,
      onHighlight: vi.fn(),
      profiles: columns.map(() => STANDARD_PROFILE),
      farmingSystems: columns.map(() => 'Konventionel' as const),
      statements: columns.map(() => statement),
    }),
  )

const render = (columns: ComparedColumn[]) =>
  renderToStaticMarkup(view(columns))

// The row's label followed by its cells' text.
const row = (html: string, label: string) => {
  const container = document.createElement('div')
  container.innerHTML = html
  const selected = [...container.querySelectorAll('tr')].find(
    (element) => element.querySelector('th')?.textContent === label,
  )
  return selected
    ? [...selected.querySelectorAll('th, td')].map((cell) => cell.textContent)
    : null
}

describe('ComparisonEconomics', () => {
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

  it('adds kvotehandel to the regnskab when a simulation traded', () => {
    const html = render([column('Med handel', [bought]), column('Uden', [])])
    // Per ha of 40 ha: 8.000 kr bought is 200 kr/ha.
    expect(row(html, 'Købt kvote')).toEqual(['Købt kvote', '−200', '0'])
    expect(row(html, 'Kvotehandel i alt')).toEqual([
      'Kvotehandel i alt',
      '−200',
      '0',
    ])
    // 330.000 kr less 8.000 kr, per ha.
    expect(row(html, 'Dækningsbidrag inkl. kvotehandel')).toEqual([
      'Dækningsbidrag inkl. kvotehandel',
      '8.050',
      '8.250',
    ])
    expect(row(html, 'Dækningsbidrag')).toBeNull()
  })

  it('stays as before when no simulation traded', () => {
    const html = render([column('Uden', [])])
    expect(row(html, 'Kvotehandel')).toBeNull()
    expect(row(html, 'Dækningsbidrag')?.slice(0, 2)).toEqual([
      'Dækningsbidrag',
      '8.250',
    ])
  })

  const sold: SimulationQuotaTrade = {
    ...bought,
    catchmentId: 2,
    tradeKgByYear: Object.fromEntries(
      ROTATION_CALENDAR_YEARS.map((year) => [year, -200]),
    ),
    paymentDkkPerYear: -6_000,
  }

  it.each([
    {
      name: 'purchase costs',
      trades: [bought],
      perHa: '8.050',
      total: '322.000',
    },
    { name: 'sales income', trades: [sold], perHa: '8.400', total: '336.000' },
    {
      name: 'mixed trades',
      trades: [bought, sold],
      perHa: '8.200',
      total: '328.000',
    },
  ])(
    'includes $name once when switching between kr/ha and kr i alt',
    async ({ trades, perHa, total }) => {
      const columns = [column('Med handel', trades)]
      await act(async () => root.render(view(columns)))
      const before = row(
        container.innerHTML,
        'Dækningsbidrag inkl. kvotehandel',
      )?.[1]

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="kr i alt"]')!
          .click()
      })

      expect({
        perHa: before,
        total: row(
          container.innerHTML,
          'Dækningsbidrag inkl. kvotehandel',
        )?.[1],
      }).toEqual({ perHa, total })
    },
  )
})
