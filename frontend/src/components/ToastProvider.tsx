import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { ToastContext } from '@/components/toast'
import { cn } from '@/lib/utils'

const TOAST_MS = 4000

type Toast = {
  id: number
  message: string
  error: boolean
}

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const value = useMemo(() => {
    const show = (message: string, error: boolean) =>
      setToast((current) => ({ id: (current?.id ?? 0) + 1, message, error }))
    return {
      showToast: (message: string) => show(message, false),
      showError: (message: string | null) =>
        message
          ? show(message, true)
          : setToast((current) => (current?.error ? null : current)),
    }
  }, [])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <p
          key={toast.id}
          role={toast.error ? 'alert' : 'status'}
          className={cn(
            'fixed bottom-7 left-1/2 z-[60] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[10px] px-[18px] py-3 text-sm shadow-lg motion-safe:animate-rise-in',
            toast.error
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-foreground text-background',
          )}
        >
          {toast.message}
        </p>
      ) : null}
    </ToastContext.Provider>
  )
}
