import { z } from 'zod'

import type {
  CatchmentYearlyNLoadCaps,
  YearlyOptimizeSimulationInput,
} from '@/api/types'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'
import { checkNumberText } from '@/lib/form-validation'
import {
  checkCropExclusion,
  checkTimeLimit,
} from '@/lib/optimization-form'

// Number inputs are kept as the text typed; an empty cap means no limit.
export type CatchmentCapInput = {
  sameForAllYears: boolean
  uniform: string
  // One entry per year in ROTATION_CALENDAR_YEARS, in the same order.
  perYear: string[]
}

export const DEFAULT_CATCHMENT_CAP_INPUT: CatchmentCapInput = {
  sameForAllYears: true,
  uniform: '',
  perYear: ROTATION_CALENDAR_YEARS.map(() => ''),
}

export type YearlyOptimizeFormValues = {
  // Keyed by catchmentCapKey. A catchment without an entry has no limits.
  catchmentCaps: Record<string, CatchmentCapInput>
  db2SwingPct: string
  excludedCropCodes: number[]
  timeLimitSeconds: string
}

export const DEFAULT_YEARLY_OPTIMIZE_FORM_VALUES: YearlyOptimizeFormValues = {
  catchmentCaps: {},
  db2SwingPct: '',
  excludedCropCodes: [],
  timeLimitSeconds: '20',
}

// react-hook-form reads a numeric path segment as an array index, so the key
// never starts with the catchment's id.
export const catchmentCapKey = (catchmentKey: string) =>
  `catchment-${catchmentKey}`

export const catchmentCapInput = (
  values: YearlyOptimizeFormValues,
  catchmentKey: string,
): CatchmentCapInput =>
  values.catchmentCaps[catchmentCapKey(catchmentKey)] ??
  DEFAULT_CATCHMENT_CAP_INPUT

// Switching to per-year limits starts every year from the shared limit, so a
// single year can be adjusted without retyping the rest.
export const withSameForAllYears = (
  input: CatchmentCapInput,
  sameForAllYears: boolean,
): CatchmentCapInput =>
  !sameForAllYears && input.perYear.every((value) => value.trim() === '')
    ? {
        ...input,
        sameForAllYears,
        perYear: ROTATION_CALENDAR_YEARS.map(() => input.uniform),
      }
    : { ...input, sameForAllYears }

export const YEARLY_OPTIMIZE_FORM_STEPS = [
  {
    id: 'limits',
    label: 'Grænser',
    fields: ['catchmentCaps', 'db2SwingPct'],
  },
  { id: 'crops', label: 'Afgrøder', fields: ['excludedCropCodes'] },
  { id: 'run', label: 'Kørsel', fields: ['timeLimitSeconds'] },
  // Only reviews the earlier steps, which are validated again before running.
  { id: 'confirm', label: 'Bekræft', fields: [] },
] as const satisfies readonly {
  id: string
  label: string
  fields: readonly (keyof YearlyOptimizeFormValues)[]
}[]

const CAP_MESSAGE = 'Skal være 0 eller mere'

export const yearlyOptimizeFormSchema = (availableCropCodes: number[]) =>
  z.custom<YearlyOptimizeFormValues>().superRefine((values, ctx) => {
    // Only the limits in use are checked; hidden per-year values are ignored.
    for (const [key, input] of Object.entries(values.catchmentCaps)) {
      if (input.sameForAllYears) {
        checkNumberText(
          ctx,
          ['catchmentCaps', key, 'uniform'],
          input.uniform,
          (value) => value >= 0,
          CAP_MESSAGE,
          { optional: true },
        )
      } else {
        input.perYear.forEach((text, index) =>
          checkNumberText(
            ctx,
            ['catchmentCaps', key, 'perYear', index],
            text,
            (value) => value >= 0,
            CAP_MESSAGE,
            { optional: true },
          ),
        )
      }
    }
    // Mirrors the backend's db2_swing_pct: empty or 0 and above.
    checkNumberText(
      ctx,
      ['db2SwingPct'],
      values.db2SwingPct,
      (value) => value >= 0,
      CAP_MESSAGE,
      { optional: true },
    )
    checkCropExclusion(
      ctx,
      ['excludedCropCodes'],
      values.excludedCropCodes,
      availableCropCodes,
    )
    checkTimeLimit(ctx, ['timeLimitSeconds'], values.timeLimitSeconds)
  })

// Every issue belongs to the step owning the first segment of its path.
export const invalidStepIndexes = (
  schema: ReturnType<typeof yearlyOptimizeFormSchema>,
  values: YearlyOptimizeFormValues,
): Set<number> => {
  const result = schema.safeParse(values)
  if (result.success) return new Set()
  const indexes = new Set<number>()
  for (const issue of result.error.issues) {
    const index = YEARLY_OPTIMIZE_FORM_STEPS.findIndex((step) =>
      (step.fields as readonly PropertyKey[]).includes(issue.path[0]),
    )
    if (index >= 0) indexes.add(index)
  }
  return indexes
}

const toOptionalNumber = (text: string) =>
  text.trim() === '' ? null : Number(text)

// Years without a limit are left out, as the backend expects.
export const catchmentYearlyCaps = (
  input: CatchmentCapInput,
): Record<number, number> => {
  const caps: Record<number, number> = {}
  ROTATION_CALENDAR_YEARS.forEach((year, index) => {
    const cap = toOptionalNumber(
      input.sameForAllYears ? input.uniform : (input.perYear[index] ?? ''),
    )
    if (cap !== null) caps[year] = cap
  })
  return caps
}

export const toYearlyOptimizeSimulationInput = (
  values: YearlyOptimizeFormValues,
  catchments: { catchmentId: number | null; key: string }[],
): YearlyOptimizeSimulationInput => ({
  timeLimitSeconds: Number(values.timeLimitSeconds),
  maxNLoadByCatchment: catchments.map(
    ({ catchmentId, key }): CatchmentYearlyNLoadCaps => ({
      catchmentId,
      maxNLoadByYear: catchmentYearlyCaps(catchmentCapInput(values, key)),
    }),
  ),
  db2SwingPct: toOptionalNumber(values.db2SwingPct),
  excludedCropCodes: values.excludedCropCodes,
})
