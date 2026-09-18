import type { FieldRecord, OptimizationStatus } from '@/api/types'

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

const rotationSignature = (field: FieldRecord) =>
  `${field.rotationId ?? ''}|${field.cropRotation
    .map((year) => `${year.cropCode}:${year.undersownCropCode ?? ''}`)
    .join(',')}`

const sum = (fields: FieldRecord[], pick: (field: FieldRecord) => number) =>
  fields.reduce((total, field) => total + pick(field), 0)

export const summarizeOptimizationChanges = (
  before: FieldRecord[],
  after: FieldRecord[],
): OptimizationChanges => {
  const beforeById = new Map(before.map((field) => [field.id, field]))
  const changedFields = after.filter((field) => {
    const previous = beforeById.get(field.id)
    return !previous || rotationSignature(previous) !== rotationSignature(field)
  })

  return {
    changedFields,
    db2Before: sum(before, (field) => field.db2),
    db2After: sum(after, (field) => field.db2),
    nLoadBefore: sum(before, (field) => field.nLoad),
    nLoadAfter: sum(after, (field) => field.nLoad),
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
