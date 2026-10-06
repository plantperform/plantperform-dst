import { createContext, useContext } from 'react'
import { z } from 'zod'

export type GuideStart = {
  fromProfileId: string
  simulationId?: string
  copy?: boolean
}

export type EconomicsNavigation = {
  startGuide: (start: GuideStart) => void
}

export const EconomicsNavigationContext =
  createContext<EconomicsNavigation | null>(null)

export const useEconomicsNavigation = () => {
  const context = useContext(EconomicsNavigationContext)
  if (!context) {
    throw new Error(
      'Economics navigation must be used inside EconomicsNavigationContext',
    )
  }
  return context
}

export const guideOriginSchema = z.object({
  guide: z.object({
    created: z.boolean(),
    simulationId: z.string().nullable(),
    returnTo: z.string(),
  }),
})

export type GuideOrigin = z.infer<typeof guideOriginSchema>['guide']
