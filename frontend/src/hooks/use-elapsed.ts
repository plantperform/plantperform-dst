import { useEffect, useState } from 'react'

// Milliseconds since startedAt, re-rendering once per second while active.
export const useElapsed = (startedAt: number, active: boolean) => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [active])

  return Math.max(0, now - startedAt)
}
