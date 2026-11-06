import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { mutate } from 'swr'

import {
  clearSession,
  loadCurrentUser,
  refreshAccessToken,
  setAccessToken,
} from '@/api/auth'
import { postJson } from '@/api/client'
import type { TokenResponse, User } from '@/api/types'
import { AuthContext } from '@/auth/context'
import { isEmbed, preserveEmbedKey } from '@/auth/embed'

type Credentials = { email: string; password: string }

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const location = useLocation()

  useEffect(preserveEmbedKey, [location])

  useEffect(() => {
    let active = true
    const restore = async () => {
      try {
        const current = await loadCurrentUser()
        if (active) setUser(current)
      } catch {
        if (active) setUser(null)
      }
      if (active) setIsLoading(false)
    }
    void restore()
    const onExpired = () => {
      if (active) setUser(null)
    }
    window.addEventListener('auth:expired', onExpired)
    return () => {
      active = false
      window.removeEventListener('auth:expired', onExpired)
    }
  }, [])

  useEffect(() => {
    if (!isLoading) document.getElementById('app-splash')?.remove()
  }, [isLoading])

  useEffect(() => {
    if (!user || isEmbed) return
    const refreshTimer = window.setInterval(
      () => {
        void refreshAccessToken()
      },
      10 * 60 * 1000,
    )
    return () => window.clearInterval(refreshTimer)
  }, [user])

  const value = {
    user,
    isLoading,
    signIn: async (credentials: Credentials) => {
      if (isEmbed) throw new Error('Denne visning er skrivebeskyttet.')
      const result = await postJson<TokenResponse, Credentials>(
        '/auth/login',
        credentials,
      )
      setAccessToken(result.accessToken)
      await mutate(() => true, undefined, { revalidate: false })
      const current = await loadCurrentUser()
      if (!current) throw new Error('Kunne ikke indlæse brugeren.')
      setUser(current)
    },
    signOut: async () => {
      await clearSession()
      setUser(null)
    },
  }

  if (isEmbed && (isLoading || !user)) {
    return (
      <main className="p-6" role="status">
        {isLoading
          ? 'Indlæser indhold…'
          : 'Indholdet er ikke tilgængeligt. Linket mangler eller adgangen er fjernet.'}
      </main>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
