import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  EconomicsContext,
  type EconomicsFocusRequest,
} from '@/components/farm/economics-context'
import { NO_OVERRIDES, type EconomicsOverrides } from '@/lib/economics'
import { EXAMPLE_ECONOMICS } from '@/lib/economics-example'

type EconomicsProviderProps = {
  onShowLine?: () => void
  children: ReactNode
}

export const EconomicsProvider = ({
  onShowLine,
  children,
}: EconomicsProviderProps) => {
  const [overrides, setOverrides] = useState<EconomicsOverrides>(NO_OVERRIDES)
  const [focusRequest, setFocusRequest] =
    useState<EconomicsFocusRequest | null>(null)
  const nonce = useRef(0)
  const onShowLineRef = useRef(onShowLine)
  const canShowLine = onShowLine !== undefined

  useEffect(() => {
    onShowLineRef.current = onShowLine
  })

  const clearFocusRequest = useCallback(() => setFocusRequest(null), [])
  const showLine = useCallback((cropCode: number, lineId: string) => {
    nonce.current += 1
    setFocusRequest({ cropCode, lineId, nonce: nonce.current })
    onShowLineRef.current?.()
  }, [])

  const value = useMemo(
    () => ({
      assumptions: EXAMPLE_ECONOMICS,
      overrides,
      setOverrides,
      focusRequest,
      clearFocusRequest,
      showLine: canShowLine ? showLine : undefined,
    }),
    [overrides, focusRequest, clearFocusRequest, canShowLine, showLine],
  )

  return (
    <EconomicsContext.Provider value={value}>
      {children}
    </EconomicsContext.Provider>
  )
}
