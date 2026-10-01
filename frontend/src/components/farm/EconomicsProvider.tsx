import { useMemo, useState, type ReactNode } from 'react'

import { EconomicsContext } from '@/components/farm/economics-context'
import { NO_OVERRIDES, type EconomicsOverrides } from '@/lib/economics'
import { EXAMPLE_ECONOMICS } from '@/lib/economics-example'

export const EconomicsProvider = ({ children }: { children: ReactNode }) => {
  const [overrides, setOverrides] = useState<EconomicsOverrides>(NO_OVERRIDES)
  const value = useMemo(
    () => ({ assumptions: EXAMPLE_ECONOMICS, overrides, setOverrides }),
    [overrides],
  )

  return (
    <EconomicsContext.Provider value={value}>
      {children}
    </EconomicsContext.Provider>
  )
}
