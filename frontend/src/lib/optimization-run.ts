import type { FieldRecord, OptimizationStatus } from '@/api/types'
import { computeFieldTotals, rotationsEqual } from '@/lib/field-domain'

export type OptimizationKind = 'optimize' | 'yearly'

export const OPTIMIZATION_KIND_LABELS: Record<OptimizationKind, string> = {
  optimize: 'Optimering',
  yearly: 'Års-optimering',
}

export const RUN_STATUS_LABELS: Record<OptimizationStatus, string> = {
  OPTIMAL: 'optimal løsning',
  FEASIBLE: 'brugbar løsning, tidsgrænsen blev nået',
}

export type OptimizationChanges = {
  // Fields whose sædskifte or its placement in the years changed, as returned
  // by the run.
  changedFields: FieldRecord[]
  db2Before: number
  db2After: number
  nLoadBefore: number
  nLoadAfter: number
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
  const totalsBefore = computeFieldTotals(before, true)
  const totalsAfter = computeFieldTotals(after, true)

  return {
    changedFields,
    db2Before: totalsBefore.db2,
    db2After: totalsAfter.db2,
    nLoadBefore: totalsBefore.nLoad,
    nLoadAfter: totalsAfter.nLoad,
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
