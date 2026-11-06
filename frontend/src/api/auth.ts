import { mutate } from 'swr'
import type { RequestParameters } from 'maplibre-gl'

import type { TokenResponse, User } from '@/api/types'
import { getEmbedKey, isEmbed } from '@/auth/embed'

let accessToken: string | null = null
let refreshPromise: Promise<string | null> | null = null

export const getAccessToken = () => (isEmbed ? getEmbedKey() : accessToken)

export const apiAuthOptions = (initialHeaders?: HeadersInit) => {
  const headers = new Headers(initialHeaders)
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return {
    headers,
    credentials: (isEmbed ? 'omit' : 'include') as RequestCredentials,
    ...(isEmbed ? { cache: 'no-store' as const } : {}),
  }
}

export const apiResourceRequest = (url: string) => {
  const resolved = new URL(url, window.location.origin)
  if (
    resolved.origin !== window.location.origin ||
    !resolved.pathname.startsWith('/api/v0/')
  ) {
    return { url }
  }
  const options = apiAuthOptions()
  return {
    url,
    ...options,
    // MapLibre forwards this to Request unchanged, but its type omits fetch's 'omit'.
    credentials: options.credentials as RequestParameters['credentials'],
    headers: Object.fromEntries(options.headers),
  }
}

export const setAccessToken = (token: string | null) => {
  accessToken = token
}

const readTokenResponse = async (
  response: Response,
): Promise<TokenResponse> => {
  if (!response.ok)
    throw new Error(`Token request failed with status ${response.status}`)
  return (await response.json()) as TokenResponse
}

export const refreshAccessToken = async (): Promise<string | null> => {
  if (isEmbed) return null
  if (refreshPromise) return refreshPromise
  refreshPromise = fetch('/api/v0/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (response) => {
      if (response.status === 401) {
        setAccessToken(null)
        window.dispatchEvent(new Event('auth:expired'))
        return null
      }
      const result = await readTokenResponse(response)
      setAccessToken(result.accessToken)
      return result.accessToken
    })
    .catch(() => {
      setAccessToken(null)
      window.dispatchEvent(new Event('auth:expired'))
      return null
    })
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

export const loadCurrentUser = async (): Promise<User | null> => {
  const token = getAccessToken() ?? (await refreshAccessToken())
  if (!token) return null
  const response = await fetch('/api/v0/auth/me', apiAuthOptions())
  if (!response.ok) {
    setAccessToken(null)
    return null
  }
  return (await response.json()) as User
}

export const clearSession = async () => {
  try {
    if (!isEmbed) {
      await fetch('/api/v0/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    }
  } finally {
    setAccessToken(null)
    await mutate(() => true, undefined, { revalidate: false })
  }
}
