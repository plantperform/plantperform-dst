import { useCallback, useSyncExternalStore } from 'react'

const heightQuery = (maxHeight: number) =>
  window.matchMedia(`(max-height: ${maxHeight - 1}px)`)

export const useViewportShorterThan = (maxHeight: number): boolean => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const query = heightQuery(maxHeight)
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    [maxHeight],
  )

  return useSyncExternalStore(
    subscribe,
    () => heightQuery(maxHeight).matches,
    () => false,
  )
}
