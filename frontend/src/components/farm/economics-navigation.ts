import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { STANDARD_PROFILE_ID } from '@/lib/economics-profiles'

export const guideOriginSchema = z.object({
  guide: z.object({
    simulationId: z.string().nullable(),
    returnTo: z.string(),
  }),
})

export type GuideOrigin = z.infer<typeof guideOriginSchema>['guide']

type GuideStart = {
  fromProfileId: string
  simulationId?: string
}

export const useStartGuide = () => {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const { guidePath } = useEconomicsProfiles()

  return ({ fromProfileId, simulationId }: GuideStart) =>
    navigate(
      guidePath(
        fromProfileId === STANDARD_PROFILE_ID
          ? crypto.randomUUID()
          : fromProfileId,
      ),
      {
        state: {
          guide: {
            simulationId: simulationId ?? null,
            returnTo: `${pathname}${search}`,
          },
        },
      },
    )
}

export const returnTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('overview') }),
  z.object({ kind: z.literal('compare'), search: z.string() }),
  z.object({
    kind: z.literal('simulation'),
    simulationId: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal('field'),
    simulationId: z.string().nullable(),
    fieldId: z.string(),
    name: z.string(),
    calculationYearIndex: z.number().nullable(),
  }),
])

export type ReturnTarget = z.infer<typeof returnTargetSchema>

export type FieldReturnTarget = Extract<ReturnTarget, { kind: 'field' }>

export const returnTargetLabel = (target: ReturnTarget): string => {
  if (target.kind === 'overview') return 'Tilbage til Oversigt'
  if (target.kind === 'compare') return 'Tilbage til Sammenlign'
  return `Tilbage til ${target.name}`
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

export const useCalculationReturn = (fieldId: string) => {
  const { pathname, search, state } = useLocation()
  const navigate = useNavigate()
  const returned = calculationReturnSchema.safeParse(state)
  const [yearIndex, setYearIndex] = useState(() =>
    returned.success && returned.data.calculation.fieldId === fieldId
      ? returned.data.calculation.yearIndex
      : undefined,
  )
  const pending = returned.success

  useEffect(() => {
    if (pending) navigate({ pathname, search }, { replace: true })
  }, [navigate, pathname, pending, search])

  return [yearIndex, () => setYearIndex(undefined)] as const
}
