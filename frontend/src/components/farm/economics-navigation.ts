import { createContext, useContext, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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

export const returnTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('overview') }),
  z.object({ kind: z.literal('compare'), search: z.string() }),
  z.object({
    kind: z.literal('simulation'),
    simulationId: z.string(),
    label: z.string(),
  }),
  z.object({
    kind: z.literal('field'),
    simulationId: z.string().nullable(),
    fieldId: z.string(),
    label: z.string(),
    calculationYearIndex: z.number().nullable(),
  }),
])

export type ReturnTarget = z.infer<typeof returnTargetSchema>

export type FieldReturnTarget = Extract<ReturnTarget, { kind: 'field' }>

export const returnTargetLabel = (target: ReturnTarget): string => {
  if (target.kind === 'overview') return 'Tilbage til Oversigt'
  if (target.kind === 'compare') return 'Tilbage til Sammenlign'
  return target.label
}

const calculationReturnSchema = z.object({
  calculation: z.object({ fieldId: z.string(), yearIndex: z.number() }),
})

export const calculationReturnState = (
  target: ReturnTarget,
): z.infer<typeof calculationReturnSchema> | null =>
  target.kind === 'field' && target.calculationYearIndex !== null
    ? {
        calculation: {
          fieldId: target.fieldId,
          yearIndex: target.calculationYearIndex,
        },
      }
    : null

export const useCalculationReturn = (fieldId: string): number | undefined => {
  const { pathname, search, state } = useLocation()
  const navigate = useNavigate()
  const returned = calculationReturnSchema.safeParse(state)
  const [yearIndex] = useState(() =>
    returned.success && returned.data.calculation.fieldId === fieldId
      ? returned.data.calculation.yearIndex
      : undefined,
  )
  const pending = returned.success

  useEffect(() => {
    if (pending) navigate({ pathname, search }, { replace: true })
  }, [navigate, pathname, pending, search])

  return yearIndex
}
