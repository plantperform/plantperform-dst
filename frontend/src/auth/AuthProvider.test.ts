// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const key = `pp_embed_${'a'.repeat(43)}`
const credentials = { email: 'editor@example.com', password: 'password' }
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.history.replaceState(null, '', `/farms/example#key=${key}`)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const renderAuth = async () => {
  const { MemoryRouter } = await import('react-router-dom')
  const { AuthProvider } = await import('@/auth/AuthProvider')
  const { useAuth } = await import('@/auth/context')
  let auth: ReturnType<typeof useAuth>
  const Probe = () => {
    auth = useAuth()
    return createElement(
      'p',
      null,
      auth.user
        ? `${auth.user.role}:${auth.user.email ?? 'anonymous'}`
        : 'signed out',
    )
  }
  await act(async () =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(AuthProvider, { children: createElement(Probe) }),
      ),
    ),
  )
  return () => auth
}

it('renders an authenticated viewer from the shared endpoint', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ email: null, role: 'viewer' })),
  )

  await renderAuth()

  expect(container.textContent).toBe('viewer:anonymous')
})

it.each(['', 'invalid', key])(
  'shows unavailable when fragment key %j cannot authenticate',
  async (value) => {
    window.history.replaceState(null, '', `/farms/example#key=${value}`)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 401 })),
    )

    await renderAuth()

    expect(container.textContent).toContain('Indholdet er ikke tilgængeligt.')
  },
)

it('does not schedule account refreshes for a viewer using an embed key', async () => {
  vi.useFakeTimers()
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ email: null, role: 'viewer' }))
  vi.stubGlobal('fetch', fetch)
  await renderAuth()
  fetch.mockClear()

  await act(async () => vi.advanceTimersByTimeAsync(20 * 60 * 1000))

  expect(fetch).not.toHaveBeenCalled()
})

it('prevents account sign-in from an embed session', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ email: null, role: 'viewer' }))
  vi.stubGlobal('fetch', fetch)
  const auth = await renderAuth()
  fetch.mockClear()

  await auth()
    .signIn(credentials)
    .catch(() => undefined)

  expect(fetch).not.toHaveBeenCalled()
})

it('clears the local viewer on sign-out', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ email: null, role: 'viewer' })),
  )
  const auth = await renderAuth()

  await act(async () => auth().signOut())

  expect(container.textContent).toContain('Indholdet er ikke tilgængeligt.')
})

it('does not log out the existing account when signing out of an embed', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ email: null, role: 'viewer' }))
  vi.stubGlobal('fetch', fetch)
  const auth = await renderAuth()
  fetch.mockClear()

  await act(async () => auth().signOut())

  expect(fetch).not.toHaveBeenCalled()
})

it('replaces the viewer screen when access expires', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ email: null, role: 'viewer' })),
  )
  await renderAuth()

  await act(async () => {
    window.dispatchEvent(new Event('auth:expired'))
  })

  expect(container.textContent).toContain('Indholdet er ikke tilgængeligt.')
})

it('signs in normally when no key is present', async () => {
  window.history.replaceState(null, '', '/login')
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
  vi.stubGlobal('fetch', fetch)
  const auth = await renderAuth()
  fetch
    .mockResolvedValueOnce(Response.json({ accessToken: 'normal-token' }))
    .mockResolvedValueOnce(
      Response.json({ email: credentials.email, role: 'editor' }),
    )

  await act(async () => auth().signIn(credentials))

  expect(container.textContent).toBe(`editor:${credentials.email}`)
})
