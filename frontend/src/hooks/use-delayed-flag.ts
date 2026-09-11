import { useEffect, useState } from 'react'

type DelayState = {
  active: boolean
  elapsed: boolean
}

export const useDelayedFlag = (active: boolean, delayMs: number) => {
  const [state, setState] = useState<DelayState>({ active, elapsed: false })

  if (state.active !== active) {
    setState({ active, elapsed: false })
  }

  useEffect(() => {
    if (!active) return
    const timeout = window.setTimeout(
      () =>
        setState((current) =>
          current.active ? { ...current, elapsed: true } : current,
        ),
      delayMs,
    )
    return () => window.clearTimeout(timeout)
  }, [active, delayMs])

  return active && state.elapsed
}
