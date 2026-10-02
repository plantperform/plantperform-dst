import { createContext } from 'react'

import type { EconomicsAssumptions, EconomicsOverrides } from '@/lib/economics'

export type BreakdownEconomics = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
  profilePath: string
}

export const BreakdownEconomicsContext =
  createContext<BreakdownEconomics | null>(null)
