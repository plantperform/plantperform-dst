import type { ActiveOptimizationStatus, FieldRecord, OptimizeSimulationResponse } from '@/api/types'
import {
  computeFieldTotals,
  rotationsEqual,
  type FieldTotals,
} from '@/lib/field-domain'

export const LARGE_PHASE_LABELS = {
  queued_large: 'Venter på mere hukommelse',
  in_progress_large: 'Kører med mere hukommelse',
} as const

export const isLargeOptimizationStatus = (status?: string): status is keyof typeof LARGE_PHASE_LABELS =>
  status === 'queued_large' || status === 'in_progress_large'

export const isActiveOptimizationStatus = (status?: string): status is ActiveOptimizationStatus =>
  status === 'queued' || status === 'in_progress' || isLargeOptimizationStatus(status)

export type OptimizationKind = 'optimize' | 'yearly'

// The two kinds differ in how the udledningskvote applies: to the average of
// the simulation's years, or as a ceiling in each calendar year.
export const OPTIMIZATION_KIND_LABELS: Record<OptimizationKind, string> = {
  optimize: 'Gennemsnit for perioden',
  yearly: 'Loft hvert år',
}

export const PERIOD_AVERAGE_OFFERED = false

// "Optimering (loft hvert år)", so a run's status names the type it was
// started with.
export const optimizationRunName = (kind: OptimizationKind) =>
  `Optimering (${OPTIMIZATION_KIND_LABELS[kind].toLowerCase()})`

export const optimizationStatusLabel = ({
  status,
  optimalityGapPct,
}: Pick<OptimizeSimulationResponse, 'status' | 'optimalityGapPct'>) => {
  const timedOut = 'brugbar løsning, tidsgrænsen blev nået'
  if (optimalityGapPct == null) {
    return status === 'OPTIMAL' ? 'løsning inden for 0,3 % af det bedst mulige' : timedOut
  }
  const gap = (Math.ceil(optimalityGapPct * 10) / 10).toLocaleString('da-DK')
  const quality = `afstand til den øvre grænse for DB2 er højst ${gap} %`
  return status === 'FEASIBLE' ? `${timedOut}, ${quality}` : `løsning fundet, ${quality}`
}

export const infeasibleRunHeading = (errorCode?: string) =>
  errorCode === 'NO_SOLUTION_WITHIN_TIME_LIMIT' ? 'Ingen løsning fundet' : 'Ingen mulig løsning'

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
