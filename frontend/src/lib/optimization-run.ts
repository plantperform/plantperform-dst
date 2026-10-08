import type { FieldRecord, OptimizationStatus } from '@/api/types'
import {
  computeFieldTotals,
  rotationsEqual,
  type FieldTotals,
} from '@/lib/field-domain'

export type OptimizationKind = 'optimize' | 'yearly'

// The two kinds differ in how the udledningskvote applies: to the average of
// the simulation's years, or as a ceiling in each calendar year.
export const OPTIMIZATION_KIND_LABELS: Record<OptimizationKind, string> = {
  optimize: 'Gennemsnit for perioden',
  yearly: 'Loft hvert år',
}

// "Optimering (loft hvert år)", so a run's status names the type it was
// started with.
export const optimizationRunName = (kind: OptimizationKind) =>
  `Optimering (${OPTIMIZATION_KIND_LABELS[kind].toLowerCase()})`

// The solver stops once it has proven its solution within 0.3 % of the best
// possible DB2 and reports OPTIMAL (RELATIVE_GAP_LIMIT in the optimizer), so
// OPTIMAL is not "proven best". Keep the percentage in step with it.
export const RUN_STATUS_LABELS: Record<OptimizationStatus, string> = {
  OPTIMAL: 'løsning inden for 0,3 % af det bedst mulige',
  FEASIBLE: 'brugbar løsning, tidsgrænsen blev nået',
}

const OUT_OF_TIME_STATUS = 503

const formatDuration = (seconds: number) => {
  if (seconds % 60 !== 0) return `${seconds} sekunder`
  const minutes = seconds / 60
  return minutes === 1 ? '1 minut' : `${minutes} minutter`
}

export const optimizationFailureMessage = (
  failure: { status?: number; message: string },
  timeLimitSeconds: number,
) =>
  failure.status === OUT_OF_TIME_STATUS
    ? `Optimeringen fandt ikke en løsning inden for ${formatDuration(
        timeLimitSeconds,
      )}. Prøv at lempe reglerne, fx en højere maks. udledning, ` +
      'eller udeluk nogle afgrøder, så der er færre muligheder at gennemgå.'
    : failure.message

export type OptimizationChanges = {
  // Fields whose sædskifte or its placement in the years changed, as returned
  // by the run.
  changedFields: FieldRecord[]
  totalsBefore: FieldTotals
  totalsAfter: FieldTotals
}

export const summarizeOptimizationChanges = (
  before: FieldRecord[],
  after: FieldRecord[],
): OptimizationChanges => {
  const beforeById = new Map(before.map((field) => [field.id, field]))
  const changedFields = after.filter((field) => {
    const previous = beforeById.get(field.id)
    return (
      !previous ||
      previous.rotationId !== field.rotationId ||
      !rotationsEqual(previous.cropRotation, field.cropRotation)
    )
  })
  return {
    changedFields,
    totalsBefore: computeFieldTotals(before, true),
    totalsAfter: computeFieldTotals(after, true),
  }
}

// "0:07", "1:32" — minutes are not padded, seconds are.
export const formatElapsed = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// "Mark 1, Mark 4 og 2 andre"
export const formatFieldNameList = (names: string[], shown = 3) => {
  if (names.length <= shown) {
    return names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`
  }
  const rest = names.length - shown
  return `${names.slice(0, shown).join(', ')} og ${rest} ${rest === 1 ? 'anden' : 'andre'}`
}
