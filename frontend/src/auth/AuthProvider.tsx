import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { mutate } from 'swr'

import { clearSession, loadCurrentUser, refreshAccessToken, setAccessToken } from '@/api/auth'
import { postJson } from '@/api/client'
import type { TokenResponse, User } from '@/api/types'
import { AuthContext } from '@/auth/context'

type Credentials = { email: string; password: string }

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    const restore = async () => {
      try {
        const current = await loadCurrentUser()
        if (active) setUser(current)
      } catch {
        if (active) setUser(null)
      } finally {
        if (active) setIsLoading(false)
      }
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
    if (!user) return
    const refreshTimer = window.setInterval(() => {
      void refreshAccessToken()
    }, 10 * 60 * 1000)
    return () => window.clearInterval(refreshTimer)
  }, [user])

  const value = useMemo(
    () => ({
      user,
      isLoading,
      signIn: async (credentials: Credentials) => {
        const result = await postJson<TokenResponse, Credentials>('/auth/login', credentials)
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
    }),
    [isLoading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
