import * as React from 'react'

const MOBILE_BREAKPOINT = 768

const mobileQuery = () =>
  window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

const subscribe = (onChange: () => void) => {
  const query = mobileQuery()
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => mobileQuery().matches,
    () => false,
  )
}
