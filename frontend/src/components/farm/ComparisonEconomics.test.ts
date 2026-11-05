import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

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

const render = (columns: ComparedColumn[]) =>
  renderToStaticMarkup(
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
    ),
  )

// The row's label followed by its cells' text.
const row = (html: string, label: string) => {
  const text = html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')
  const start = text.indexOf(`|${label}|`)
  return start < 0
    ? null
    : text
        .slice(start + 1)
        .split('|')
        .slice(0, 3)
}

describe('ComparisonEconomics', () => {
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
})
