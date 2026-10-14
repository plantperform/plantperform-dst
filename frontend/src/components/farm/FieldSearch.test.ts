// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FieldRecord } from '@/api/types'
import { FieldSearch } from '@/components/farm/FieldSearch'

describe('searching original names and personal aliases', () => {
  let container: HTMLDivElement
  let root: Root
  const select = vi.fn()
  const field = {
    id: 'actual-uuid',
    name: '12',
    alias: 'Sømarken',
    areaHa: 2,
  } as FieldRecord

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
      root.render(
        createElement(FieldSearch, {
          fields: [field],
          loading: false,
          onSelectField: select,
        }),
      ),
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each(['SØMARK', '12'])(
    'finds %s, displays the alias, and selects the original field identity',
    async (query) => {
      const input = container.querySelector('input')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, query)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(container.querySelector('[role="option"]')?.textContent).toContain(
        'Sømarken',
      )
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        ),
      )
      expect(select).toHaveBeenCalledExactlyOnceWith(field.id)
      expect(input.value).toBe('')
    },
  )
})
