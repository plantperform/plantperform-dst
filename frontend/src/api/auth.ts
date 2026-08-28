import { mutate } from 'swr'

import type { TokenResponse, User } from '@/api/types'

let accessToken: string | null = null
let refreshPromise: Promise<string | null> | null = null

export const getAccessToken = () => accessToken

export const setAccessToken = (token: string | null) => {
  accessToken = token
}

const readTokenResponse = async (response: Response): Promise<TokenResponse> => {
  if (!response.ok) throw new Error(`Token request failed with status ${response.status}`)
  return (await response.json()) as TokenResponse
}

export const refreshAccessToken = async (): Promise<string | null> => {
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
  const token = accessToken ?? (await refreshAccessToken())
  if (!token) return null
  const response = await fetch('/api/v0/auth/me', {
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    setAccessToken(null)
    return null
  }
  return (await response.json()) as User
}

export const clearSession = async () => {
  try {
    await fetch('/api/v0/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } finally {
    setAccessToken(null)
    await mutate(() => true, undefined, { revalidate: false })
  }
}
