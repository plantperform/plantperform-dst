// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const key = `pp_embed_${'a'.repeat(43)}`

beforeEach(() => {
  vi.resetModules()
  window.history.replaceState(null, '', `/farms/example#key=${key}`)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('embed requests', () => {
  it('sends the embed key instead of a normal access token', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const auth = await import('@/api/auth')
    auth.setAccessToken('editor-token')
    const { fetcher } = await import('@/api/client')

    await fetcher('/farms')

    expect(
      new Headers(fetch.mock.calls[0][1].headers).get('Authorization'),
    ).toBe(`Bearer ${key}`)
  })

  it('omits browser cookies', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const { fetcher } = await import('@/api/client')

    await fetcher('/farms')

    expect(fetch.mock.calls[0][1].credentials).toBe('omit')
  })

  it('bypasses previously cached authenticated responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const { fetcher } = await import('@/api/client')

    await fetcher('/farms')

    expect(fetch.mock.calls[0][1].cache).toBe('no-store')
  })

  it('lets the backend reject writes through the existing error handling', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"detail":"Read-only access"}', { status: 403 }),
        ),
    )
    const { postJson } = await import('@/api/client')

    const request = postJson('/farms', { name: 'Example' })

    await expect(request).rejects.toMatchObject({
      status: 403,
      message: 'Read-only access',
    })
  })

  it('does not refresh cookies after an unauthorized response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    const { fetcher } = await import('@/api/client')

    await fetcher('/farms').catch(() => undefined)

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('bootstraps through the shared account endpoint without restoring the normal login', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ email: null, role: 'viewer' }))
    vi.stubGlobal('fetch', fetch)
    const { loadCurrentUser } = await import('@/api/auth')

    await loadCurrentUser()

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/v0/auth/me'])
  })

  it('omits cookies and caching when loading the current user', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ email: null, role: 'viewer' }))
    vi.stubGlobal('fetch', fetch)
    const { loadCurrentUser } = await import('@/api/auth')

    await loadCurrentUser()

    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
    })
  })

  it('loads the viewer without fabricating an account email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ email: null, role: 'viewer' })),
    )
    const { loadCurrentUser } = await import('@/api/auth')

    const user = await loadCurrentUser()

    expect(user).toEqual({ email: null, role: 'viewer' })
  })

  it.each([
    '',
    'invalid',
    'pp_embed_short',
    `pp_embed_${'!'.repeat(43)}`,
    'eyJhbGciOiJIUzI1NiJ9.payload.signature',
  ])(
    'rejects malformed fragment credentials %j without falling back to a normal token',
    async (credential) => {
      window.history.replaceState(
        null,
        '',
        `/farms/example#key=${encodeURIComponent(credential)}`,
      )
      const { loadCurrentUser, setAccessToken } = await import('@/api/auth')
      setAccessToken('editor-token')
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)

      const user = await loadCurrentUser()

      expect({ user, requests: fetch.mock.calls }).toEqual({
        user: null,
        requests: [],
      })
    },
  )

  it('does not fall back to a normal session when the key is revoked', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    const { loadCurrentUser, setAccessToken } = await import('@/api/auth')
    setAccessToken('editor-token')

    const user = await loadCurrentUser()

    expect({ user, urls: fetch.mock.calls.map(([url]) => url) }).toEqual({
      user: null,
      urls: ['/api/v0/auth/me'],
    })
  })

  it('does not log out the normal account', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { clearSession } = await import('@/api/auth')

    await clearSession()

    expect(fetch).not.toHaveBeenCalled()
  })

  it('works without browser storage', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('Blocked')
    })
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('Blocked')
    })
    const { getAccessToken } = await import('@/api/auth')

    const token = getAccessToken()

    expect(token).toBe(key)
  })

  it('does not attach credentials to an external URL containing an API path', async () => {
    const { apiResourceRequest } = await import('@/api/auth')
    const url = 'https://tiles.example.com/api/v0/tiles/1'

    const request = apiResourceRequest(url)

    expect(request).toEqual({ url })
  })

  it('omits cookies on authenticated map requests', async () => {
    const { apiResourceRequest } = await import('@/api/auth')

    const request = apiResourceRequest('/api/v0/registry/tiles/1/1/1.pbf')

    expect(request).toMatchObject({
      credentials: 'omit',
      headers: { authorization: `Bearer ${key}` },
    })
  })

  it('preserves the key when internal navigation changes the URL', async () => {
    const { preserveEmbedKey } = await import('@/auth/embed')
    window.history.pushState(
      { navigation: true },
      '',
      '/farms/other?simulation=second',
    )

    preserveEmbedKey()

    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(`/farms/other?simulation=second#key=${key}`)
  })

  it('keeps router history state when preserving the fragment', async () => {
    const { preserveEmbedKey } = await import('@/auth/embed')
    window.history.pushState({ navigation: true }, '', '/farms/other')

    preserveEmbedKey()

    expect(window.history.state).toEqual({ navigation: true })
  })

  it('keeps normal login authentication for unrelated fragments', async () => {
    window.history.replaceState(null, '', '/reset-password#token=reset-token')
    const { getAccessToken, setAccessToken } = await import('@/api/auth')
    setAccessToken('normal-login-token')

    const token = getAccessToken()

    expect(token).toBe('normal-login-token')
  })

  it('restores the same credential after navigation and reload', async () => {
    const { preserveEmbedKey } = await import('@/auth/embed')
    window.history.pushState(null, '', '/farms/other?simulation=second')
    preserveEmbedKey()

    vi.resetModules()
    const { getAccessToken } = await import('@/api/auth')

    expect(getAccessToken()).toBe(key)
  })

  it('keeps the initial credential when a different key appears during navigation', async () => {
    const { getAccessToken } = await import('@/api/auth')

    window.history.pushState(
      null,
      '',
      `/farms/other#key=pp_embed_${'b'.repeat(43)}`,
    )

    expect(getAccessToken()).toBe(key)
  })
})

describe('normal authentication', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/farms/example')
  })

  it('restores the session before loading the account identity', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ accessToken: 'normal-token' }))
      .mockResolvedValueOnce(
        Response.json({ email: 'editor@example.com', role: 'editor' }),
      )
    vi.stubGlobal('fetch', fetch)
    const { loadCurrentUser } = await import('@/api/auth')

    await loadCurrentUser()

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v0/auth/refresh',
      '/api/v0/auth/me',
    ])
  })

  it('includes cookies when loading the account identity', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ email: 'editor@example.com', role: 'editor' }),
      )
    vi.stubGlobal('fetch', fetch)
    const { loadCurrentUser, setAccessToken } = await import('@/api/auth')
    setAccessToken('normal-token')

    await loadCurrentUser()

    expect(fetch.mock.calls[0][1].credentials).toBe('include')
  })

  it('retries an unauthorized request with a refreshed normal token', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ accessToken: 'refreshed-token' }))
      .mockResolvedValueOnce(Response.json([]))
    vi.stubGlobal('fetch', fetch)
    const { fetcher } = await import('@/api/client')

    await fetcher('/farms')

    expect(
      fetch.mock.calls.map(([url, options]) => [
        url,
        new Headers(options.headers).get('Authorization'),
      ]),
    ).toEqual([
      ['/api/v0/farms', null],
      ['/api/v0/auth/refresh', null],
      ['/api/v0/farms', 'Bearer refreshed-token'],
    ])
  })

  it('logs out the normal session', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { clearSession } = await import('@/api/auth')

    await clearSession()

    expect(fetch).toHaveBeenCalledWith('/api/v0/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  })
})
