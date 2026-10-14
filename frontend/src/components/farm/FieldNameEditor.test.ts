// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SWRConfig, type Cache } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetcher, patchJson } from '@/api/client'
import { useSimulationResults } from '@/api/hooks'
import { useFarmView, useSimulationView } from '@/api/views'
import type { FieldAliases, FieldRecord, Simulation, User } from '@/api/types'
import { AuthContext, type AuthContextValue } from '@/auth/context'
import { FieldNameEditor } from '@/components/farm/FieldNameEditor'
import { fieldDisplayName } from '@/lib/field-domain'

vi.mock('@/api/client', () => ({ fetcher: vi.fn(), patchJson: vi.fn() }))

const field = {
  id: 'registered-field',
  farmId: 'farm',
  imkId: 123,
  name: '12',
} as FieldRecord
const snapshot = { ...field, id: 'snapshot-field', name: 'Old name' }
const simulation = {
  id: 'sim',
  result: { status: 'completed', runId: 'run' },
} as Simulation
const ready = { inputRevision: 3, viewVersion: 2, status: 'done', error: null }
const farmView = {
  ...ready,
  farm: { id: 'farm' },
  data: { fields: [field], fieldYears: {}, yearlySummary: [] },
}
const simulationView = {
  ...ready,
  simulation,
  data: {
    fields: [snapshot],
    fieldYears: {},
    yearlySummary: [],
    savedResult: {
      runId: 'run',
      resultRevision: 3,
      response: { fields: [snapshot] },
      fieldsBefore: [field],
      fieldYears: {},
    },
  },
}

const Labels = () => {
  const farm = useFarmView('farm')
  const sim = useSimulationView('farm', 'sim')
  const results = useSimulationResults('farm', [simulation])
  const fields = [
    farm.data?.data?.fields[0],
    sim.data?.data?.fields[0],
    results.data?.sim?.response.fields[0],
    results.data?.sim?.fieldsBefore[0],
  ]
  return createElement(
    'div',
    { 'data-labels': true },
    fields.map((entry, index) =>
      createElement(
        'span',
        { key: index },
        entry ? fieldDisplayName(entry) : 'Loading',
      ),
    ),
  )
}

describe('personal field alias editor and reactive views', () => {
  let root: Root
  let container: HTMLDivElement
  let cache: Cache
  let email: string
  let preferences: Record<string, FieldAliases>

  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  const render = async () => {
    const auth: AuthContextValue = {
      user: { email } as User,
      isLoading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    }
    await act(async () =>
      root.render(
        createElement(
          AuthContext.Provider,
          { value: auth },
          createElement(
            SWRConfig,
            { value: { provider: () => cache, shouldRetryOnError: false } },
            createElement(FieldNameEditor, { farmId: 'farm', field }),
            createElement(FieldNameEditor, {
              farmId: 'second',
              field: { ...field, id: 'other-registration', name: '99' },
            }),
            createElement(FieldNameEditor, {
              farmId: 'farm',
              field: snapshot,
              simulationId: 'sim',
            }),
            createElement(Labels),
          ),
        ),
      ),
    )
    await flush()
  }
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (entry) =>
        entry.getAttribute('aria-label') === label ||
        entry.textContent === label,
    )
    expect(button, label).toBeDefined()
    await act(async () => button!.click())
  }
  const change = async (value: string) => {
    const input = container.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const key = async (value: string) => {
    await act(async () =>
      container.querySelector('input')!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: value,
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
  }
  const headings = () =>
    [...container.querySelectorAll('h2')].map((entry) => entry.textContent)
  const labels = () =>
    [...container.querySelectorAll('[data-labels] span')].map(
      (entry) => entry.textContent,
    )

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.resetAllMocks()
    email = 'first@example.com'
    preferences = {
      [email]: {},
      'second@example.com': { 'imk:123': 'Anden brugers alias' },
    }
    cache = new Map()
    vi.mocked(fetcher).mockImplementation(async (path) => {
      if (path === '/field-aliases') return { ...preferences[email] }
      if (path === '/farms/farm/view') return farmView
      if (path === '/farms/farm/simulations/sim/view') return simulationView
      throw new Error(`Unexpected path: ${path}`)
    })
    vi.mocked(patchJson).mockImplementation(async (_path, body) => {
      const { alias } = body as { alias: string | null }
      const value = alias?.trim() || null
      if (value === null) delete preferences[email]['imk:123']
      else preferences[email]['imk:123'] = value
      return { fieldKey: 'imk:123', alias: value }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await render()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('shares one alias read and immediately updates other farms, simulation views, and comparisons after Enter saves', async () => {
    expect(headings()).toEqual(['Mark 12', 'Mark 99', 'Mark Old name'])
    expect(
      vi
        .mocked(fetcher)
        .mock.calls.filter(([path]) => path === '/field-aliases'),
    ).toHaveLength(1)
    await click('Rediger markens alias')
    expect(document.activeElement).toBe(container.querySelector('input'))
    await change('  Sømarken  ')
    await key('Enter')
    expect(patchJson).toHaveBeenCalledExactlyOnceWith(
      '/farms/farm/fields/registered-field/alias',
      { alias: 'Sømarken' },
    )
    expect(headings()).toEqual(['Sømarken', 'Sømarken', 'Sømarken'])
    expect(labels()).toEqual(['Sømarken', 'Sømarken', 'Sømarken', 'Sømarken'])
    expect(farmView.data.fields[0].alias).toBeUndefined()
    expect(
      simulationView.data.savedResult.response.fields[0].alias,
    ).toBeUndefined()
    expect(container.textContent).toContain('Originalt navn: 12')
    expect(container.querySelector('input')).toBeNull()
  })

  it.each(['Escape', 'Annuller'])(
    'cancels using %s without changing the saved alias',
    async (action) => {
      await click('Rediger markens alias')
      await change('Unsaved')
      if (action === 'Escape') await key('Escape')
      else await click('Annuller')
      expect(patchJson).not.toHaveBeenCalled()
      expect(container.querySelector('input')).toBeNull()
      expect(headings()[0]).toBe('Mark 12')
    },
  )

  it.each(['Brug originalt navn', 'empty input'])(
    'restores each current original name using %s',
    async (action) => {
      await click('Rediger markens alias')
      await change('Shared personal name')
      await click('Gem')
      await click('Rediger markens alias')
      if (action === 'empty input') {
        await change('   ')
        await click('Gem')
      } else await click(action)
      expect(patchJson).toHaveBeenLastCalledWith(
        '/farms/farm/fields/registered-field/alias',
        { alias: null },
      )
      expect(headings()).toEqual(['Mark 12', 'Mark 99', 'Mark Old name'])
      expect(labels()).toEqual(['12', 'Old name', 'Old name', '12'])
    },
  )

  it('retains the draft on save failure and allows retry', async () => {
    vi.mocked(patchJson).mockRejectedValueOnce(
      new Error('Kunne ikke gemme alias.'),
    )
    await click('Rediger markens alias')
    await change('Draft')
    await click('Gem')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Kunne ikke gemme alias.',
    )
    expect(container.querySelector('input')?.value).toBe('Draft')
    expect(headings()[0]).toBe('Mark 12')
    await click('Gem')
    expect(headings()[0]).toBe('Draft')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps aliases isolated when switching users with the same view cache', async () => {
    await click('Rediger markens alias')
    await change('First user')
    await click('Gem')
    email = 'second@example.com'
    await render()
    expect(headings()).toEqual([
      'Anden brugers alias',
      'Anden brugers alias',
      'Anden brugers alias',
    ])
    expect(labels()).toEqual(Array(4).fill('Anden brugers alias'))
    expect(preferences['first@example.com']).toEqual({
      'imk:123': 'First user',
    })
    email = 'first@example.com'
    await render()
    expect(headings()).toEqual(['First user', 'First user', 'First user'])
  })

  it('keeps browsing available on alias-load failure and retries the personal cache', async () => {
    email = 'retry@example.com'
    preferences[email] = {}
    vi.mocked(fetcher).mockRejectedValueOnce(
      new Error('Alias service unavailable'),
    )
    await render()
    expect(headings()).toEqual(['Mark 12', 'Mark 99', 'Mark Old name'])
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Kunne ikke hente dine markaliaser.',
    )
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Rediger markens alias"]',
      )!.disabled,
    ).toBe(true)
    expect(labels()).toEqual(['12', 'Old name', 'Old name', '12'])
    vi.mocked(fetcher).mockRejectedValueOnce(new Error('Still unavailable'))
    await click('Prøv igen')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    await click('Prøv igen')
    await flush()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Rediger markens alias"]',
      )!.disabled,
    ).toBe(false)
  })

  it('prevents duplicate submissions while a save is pending', async () => {
    let complete!: (value: { fieldKey: string; alias: string }) => void
    vi.mocked(patchJson).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    await click('Rediger markens alias')
    await change('Pending')
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    expect(patchJson).toHaveBeenCalledOnce()
    expect(container.querySelector('input')!.disabled).toBe(true)
    expect(headings()[0]).toBe('Mark 12')
    await act(async () => complete({ fieldKey: 'imk:123', alias: 'Pending' }))
    expect(headings()).toEqual(Array(3).fill('Pending'))
  })

  it('forwards the simulation identity when editing a field snapshot', async () => {
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Rediger markens alias"]',
    )
    await act(async () => buttons[2].click())
    await change('Snapshot name')
    await click('Gem')
    expect(patchJson).toHaveBeenCalledExactlyOnceWith(
      '/farms/farm/fields/snapshot-field/alias?simulation_id=sim',
      { alias: 'Snapshot name' },
    )
    expect(headings()).toEqual(Array(3).fill('Snapshot name'))
  })
})
