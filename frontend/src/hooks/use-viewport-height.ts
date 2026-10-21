import { useSyncExternalStore } from 'react'

const heightQuery = (maxHeight: number) =>
  window.matchMedia(`(max-height: ${maxHeight - 1}px)`)

export const useViewportShorterThan = (maxHeight: number): boolean => {
  const subscribe = (onChange: () => void) => {
    const query = heightQuery(maxHeight)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }

  return useSyncExternalStore(
    subscribe,
    () => heightQuery(maxHeight).matches,
    () => false,
  )
}
