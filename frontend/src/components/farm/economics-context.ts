import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from 'react'

import type { EconomicsAssumptions, EconomicsOverrides } from '@/lib/economics'

export type EconomicsContextValue = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  setOverrides: Dispatch<SetStateAction<EconomicsOverrides>>
}

export const EconomicsContext = createContext<EconomicsContextValue | null>(
  null,
)

export const useEconomics = () => {
  const context = useContext(EconomicsContext)
  if (!context) {
    throw new Error('Economics must be used inside EconomicsProvider')
  }
  return context
}
