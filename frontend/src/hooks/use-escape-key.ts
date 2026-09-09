import { useEffect } from 'react'

const OWN_ESCAPE_LAYERS = '[role="dialog"], [role="menu"], [role="listbox"]'

export const useEscapeKey = (handleEscape: () => boolean) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(OWN_ESCAPE_LAYERS)) return
      if (!handleEscape()) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleEscape])
}
