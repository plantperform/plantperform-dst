// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { FarmCopyPreview } from '@/api/types'
import { CreateFarmPage } from '@/pages/CreateFarmPage'

const dependencies = vi.hoisted(() => ({
  post: vi.fn(),
  createFarm: vi.fn(),
  registry: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/api/client', async (original) => ({
  ...(await original<object>()),
  postJson: (...args: unknown[]) => dependencies.post(...args),
}))
vi.mock('@/api/hooks', () => ({
  farmsKey: '/farms',
  useFarms: () => ({ data: [] }),
  useRegistryFieldsByCvr: (cvr: unknown) => {
    dependencies.registry(cvr)
    return { data: undefined }
  },
  useRegistryFieldsBulk: () => ({ data: undefined }),
}))
vi.mock('@/api/mutations', () => ({
  createFarm: (...args: unknown[]) => dependencies.createFarm(...args),
  createFieldsFromRegistry: vi.fn(),
}))
vi.mock('@/api/economics', () => ({
  economicsModulesKey: '/economics-modules',
}))
vi.mock('@/auth/context', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/hooks/use-user-name', () => ({
  useUserName: () => ({ name: null }),
}))
vi.mock('@/components/toast', () => ({
  useToast: () => ({ showToast: dependencies.toast }),
}))
vi.mock('@/components/AccountButton', () => ({ AccountButton: () => null }))
vi.mock('@/components/farm/RegistryFieldsMap', () => ({
  RegistryFieldsMap: () => null,
}))

const preview: FarmCopyPreview = {
  sourceFarm: {
    id: 'source',
    name: 'Grøn gård',
    ownerName: 'Anna',
    cvr: '87654321',
    rotationLibrary: [],
  },
  fieldCount: 3,
  areaHa: 12.5,
  simulationCount: 2,
  savedResultCount: 1,
  hasUnfinishedCalculations: false,
}

const pending = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let root: Root
let container: HTMLDivElement
let router: ReturnType<typeof createMemoryRouter>

const render = async (cvr = '12345678') => {
  router = createMemoryRouter(
    [
      { path: '/farms/new', element: createElement(CreateFarmPage) },
      { path: '/farms/:id', element: createElement('p', null, 'Farm detail') },
    ],
    {
      initialEntries: [
        {
          pathname: '/farms/new',
          state: { prefill: { name: 'grøn gård', ownerName: 'ANNA', cvr } },
        },
      ],
    },
  )
  await act(async () => {
    root.render(
      createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        createElement(RouterProvider, { router }),
      ),
    )
  })
}

const button = (text: string) => {
  const element = [...container.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  if (!element) throw new Error(`Button missing: ${text}`)
  return element
}

const click = async (text: string) => {
  await act(async () => {
    button(text).click()
  })
}

const back = async () => {
  await act(async () => {
    const link = [...container.querySelectorAll('a')].find(
      (node) => node.textContent === 'Tilbage',
    )!
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    )
  })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  dependencies.post
    .mockReset()
    .mockImplementation(async (path: string) =>
      path.endsWith('/preview')
        ? preview
        : { ...preview.sourceFarm, id: 'copy' },
    )
  dependencies.createFarm
    .mockReset()
    .mockResolvedValue({ ...preview.sourceFarm, id: 'empty' })
  dependencies.registry.mockClear()
  dependencies.toast.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  router?.dispose()
  container.remove()
})

describe('copy farm creation', () => {
  it.each(['Slå op i markregistret', 'oprette bedriften uden marker'])(
    '%s opens confirmation without creating',
    async (action) => {
      await render()

      await click(action)

      expect(container.textContent).toContain('Opret en kopi af Grøn gård')
      expect(dependencies.post.mock.calls.map(([path]) => path)).toEqual([
        '/farms/copy/preview',
      ])
      expect(dependencies.createFarm).not.toHaveBeenCalled()
    },
  )

  it('Enter submission opens confirmation', async () => {
    await render()

    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(container.textContent).toContain('Opret en kopi af Grøn gård')
  })

  it('does not request registry fields for the trigger CVR', async () => {
    await render()

    await click('Slå op i markregistret')

    expect(
      dependencies.registry.mock.calls.every(([cvr]) => cvr === undefined),
    ).toBe(true)
  })

  it('shows the actual source details', async () => {
    await render()

    await click('Slå op i markregistret')

    expect(container.textContent).toContain('87 65 43 21')
    expect(container.textContent).toContain('Anna')
    expect(container.textContent).toContain('12,5 ha')
    expect(container.textContent).toContain('Simuleringer2')
  })

  it('creates only after confirmation and opens the copied farm', async () => {
    await render()
    await click('Slå op i markregistret')

    await click('Opret kopi af')

    expect(dependencies.post).toHaveBeenLastCalledWith('/farms/copy', {
      cvr: '12345678',
      name: 'grøn gård',
      ownerName: 'ANNA',
      sourceFarmId: 'source',
      requestId: expect.any(String),
    })
    expect(router.state.location.pathname).toBe('/farms/copy')
  })

  it.each([404, 409])(
    'displays lookup error %s and creates nothing',
    async (status) => {
      dependencies.post.mockRejectedValue(
        new ApiError(status, 'Ret navn og ejer.'),
      )
      await render()

      await click('Slå op i markregistret')

      expect(container.textContent).toContain('Ret navn og ejer.')
      expect(dependencies.post.mock.calls.map(([path]) => path)).toEqual([
        '/farms/copy/preview',
      ])
    },
  )

  it('preserves the trigger and names when going back', async () => {
    await render()
    await click('Slå op i markregistret')

    await back()

    expect(container.querySelector<HTMLInputElement>('#farm-name')!.value).toBe(
      'grøn gård',
    )
    expect(
      container.querySelector<HTMLInputElement>('#farm-owner-name')!.value,
    ).toBe('ANNA')
    expect(container.querySelector<HTMLInputElement>('#farm-cvr')!.value).toBe(
      '12 34 56 78',
    )
  })

  it('uses the same request ID when retrying a failed copy', async () => {
    dependencies.post.mockImplementation(async (path: string) => {
      if (path.endsWith('/preview')) return preview
      throw new ApiError(503, 'Prøv igen.')
    })
    await render()
    await click('Slå op i markregistret')
    await click('Opret kopi af')
    const first = dependencies.post.mock.calls.at(-1)![1]

    await click('Opret kopi af')

    expect(dependencies.post.mock.calls.at(-1)![1]).toEqual(first)
  })

  it('prevents duplicate copy submissions', async () => {
    const copy = pending<typeof preview.sourceFarm>()
    dependencies.post.mockImplementation((path: string) =>
      path.endsWith('/preview') ? Promise.resolve(preview) : copy.promise,
    )
    await render()
    await click('Slå op i markregistret')

    await act(async () => {
      const confirm = button('Opret kopi af')
      confirm.click()
      confirm.click()
    })

    expect(
      dependencies.post.mock.calls.filter(([path]) => path === '/farms/copy'),
    ).toHaveLength(1)
    await act(async () => copy.resolve({ ...preview.sourceFarm, id: 'copy' }))
  })

  it('ignores a preview that finishes after going back', async () => {
    const lookup = pending<FarmCopyPreview>()
    dependencies.post.mockReturnValue(lookup.promise)
    await render()
    await click('Slå op i markregistret')
    await back()

    await act(async () => lookup.resolve(preview))

    expect(container.querySelector('#farm-name')).not.toBeNull()
    expect(container.textContent).not.toContain('Opret kopi af')
  })

  it('explains unfinished calculations', async () => {
    dependencies.post.mockResolvedValue({
      ...preview,
      hasUnfinishedCalculations: true,
    })
    await render()

    await click('Slå op i markregistret')

    expect(container.textContent).toContain(
      'Nogle beregninger er ikke færdige.',
    )
  })

  it('retains normal registry lookup for another CVR', async () => {
    await render('11223344')

    await click('Slå op i markregistret')

    expect(dependencies.registry).toHaveBeenCalledWith('11223344')
    expect(dependencies.post).not.toHaveBeenCalled()
  })

  it('retains empty farm creation for another CVR', async () => {
    await render('11223344')

    await click('oprette bedriften uden marker')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })

    expect(dependencies.createFarm).toHaveBeenCalledWith({
      name: 'grøn gård',
      ownerName: 'ANNA',
      cvr: '11223344',
    })
    expect(dependencies.post).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/farms/empty')
  })
})
