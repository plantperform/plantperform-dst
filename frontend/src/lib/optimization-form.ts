import { z } from 'zod'

import type { OptimizeSimulationInput } from '@/api/types'
import { checkNumberText } from '@/lib/form-validation'

// Mirrors the backend's time_limit_seconds: above 0 and at most 600.
export const MAX_TIME_LIMIT_SECONDS = 600

export const checkTimeLimit = (
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  text: string,
) =>
  checkNumberText(
    ctx,
    path,
    text,
    (value) => value > 0 && value <= MAX_TIME_LIMIT_SECONDS,
    `Tidsgrænsen skal være over 0 og højst ${MAX_TIME_LIMIT_SECONDS} sekunder`,
    { emptyMessage: 'Angiv en tidsgrænse' },
  )

// Excluding every crop leaves no rotation to choose, which the solver would
// only report after the run has started.
export const checkCropExclusion = (
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  excludedCropCodes: number[],
  availableCropCodes: number[],
) => {
  if (
    availableCropCodes.length > 0 &&
    availableCropCodes.every((code) => excludedCropCodes.includes(code))
  ) {
    ctx.addIssue({ code: 'custom', path, message: 'Behold mindst én afgrøde' })
  }
}

export const toggleCropCode = (codes: number[], code: number): number[] =>
  codes.includes(code)
    ? codes.filter((current) => current !== code)
    : [...codes, code]

// The time limit is kept as the text the user typed, like other number fields.
export type OptimizeFormValues = {
  timeLimitSeconds: string
  excludedCropCodes: number[]
}

export const DEFAULT_OPTIMIZE_FORM_VALUES: OptimizeFormValues = {
  timeLimitSeconds: '15',
  excludedCropCodes: [],
}

export const optimizeFormSchema = (availableCropCodes: number[]) =>
  z.custom<OptimizeFormValues>().superRefine((values, ctx) => {
    checkTimeLimit(ctx, ['timeLimitSeconds'], values.timeLimitSeconds)
    checkCropExclusion(
      ctx,
      ['excludedCropCodes'],
      values.excludedCropCodes,
      availableCropCodes,
    )
  })

export const toOptimizeSimulationInput = (
  values: OptimizeFormValues,
): OptimizeSimulationInput => ({
  timeLimitSeconds: Number(values.timeLimitSeconds),
  excludedCropCodes: values.excludedCropCodes,
})
