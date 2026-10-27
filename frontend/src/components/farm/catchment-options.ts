import { useFarmEmissions } from '@/api/hooks'
import type {
  CatchmentNLoadCap,
  FieldRecord,
  OptimizationSettings,
} from '@/api/types'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'

export const numberToInput = (value: number | null) =>
  value === null ? '' : String(value)

export const inputToOptionalNumber = (value: string) => {
  const trimmed = value.trim()
  return trimmed === '' ? null : Number(trimmed)
}

export type CatchmentOption = {
  catchmentId: number | null
  label: string
  colorClass: string
}

const CATCHMENT_COLOR_CLASSES = [
  'bg-blue-700',
  'bg-fuchsia-700',
  'bg-teal-700',
  'bg-stone-600',
  'bg-violet-400',
  'bg-cyan-900',
]

const NO_CATCHMENT_COLOR_CLASS = 'bg-stone-400'

export const catchmentKey = (catchmentId: number | null) =>
  String(catchmentId ?? 'none')

export const fieldInCatchment = (
  field: Pick<FieldRecord, 'catchmentId'>,
  key: string | null,
) => catchmentKey(field.catchmentId) === key

export const describeCatchment = (
  catchmentId: number | null,
  name: string | null | undefined,
): string =>
  catchmentId === null
    ? 'Uden kystvandopland'
    : (name ?? `Kystvandopland ${catchmentId}`)

export const useCatchmentOptions = (
  farmId: string,
  fields: FieldRecord[],
): CatchmentOption[] => {
  const { data: emissions = [] } = useFarmEmissions(farmId)
  const nameById = new Map(
    emissions.map((u) => [u.catchmentId, u.catchmentName]),
  )
  const seen = new Map<string, Omit<CatchmentOption, 'colorClass'>>()
  for (const field of fields) {
    const key = catchmentKey(field.catchmentId)
    if (seen.has(key)) continue
    const label = describeCatchment(
      field.catchmentId,
      nameById.get(field.catchmentId),
    )
    seen.set(key, { catchmentId: field.catchmentId, label })
  }
  const sorted = Array.from(seen.values()).sort((a, b) =>
    a.label.localeCompare(b.label, 'da'),
  )
  const withCatchment = sorted.filter((option) => option.catchmentId !== null)
  return sorted.map((option) => ({
    ...option,
    colorClass:
      option.catchmentId === null
        ? NO_CATCHMENT_COLOR_CLASS
        : CATCHMENT_COLOR_CLASSES[
            withCatchment.indexOf(option) % CATCHMENT_COLOR_CLASSES.length
          ],
  }))
}

// A catchment with no explicitly saved cap defaults to its combined
// udledningskvote instead of "no limit" - the optimizer applies the same
// default (see orchestrator._max_n_load_by_kystvandopland), so any UI that
// shows or edits this limit should read it through here to stay in sync.
//
// The quota is a per-field property from the registry (how much a mark's
// crop history entitles it to), not something that needs a rotation to be
// picked or optimized first - so it is summed directly from `fields` here,
// deliberately not through computeFieldTotals/isFieldCalculated, which would
// hide it behind "ikke beregnet" until after the first Optimér run.
export const effectiveMaxNLoadByCatchment = (
  fields: FieldRecord[],
  savedCaps: CatchmentNLoadCap[],
): Map<string, number> => {
  const saved = new Map(
    savedCaps.map((cap) => [catchmentKey(cap.catchmentId), cap.maxNLoadKg]),
  )
  const quotas = new Map<string, number>()
  for (const field of fields) {
    if (field.catchmentId === null || !field.quotaEligible) continue
    const key = catchmentKey(field.catchmentId)
    quotas.set(key, (quotas.get(key) ?? 0) + field.nLoadQuotaKgN)
  }

  const resolved = new Map<string, number>()
  for (const key of new Set([...saved.keys(), ...quotas.keys()])) {
    if (saved.has(key)) {
      const value = saved.get(key) ?? null
      if (value !== null) resolved.set(key, value)
      continue
    }
    const quota = quotas.get(key) ?? 0
    // Summed from per-field floats, so round to a whole kg N before it
    // becomes an editable input value - nobody types ",88100000000014".
    if (quota > 0) resolved.set(key, Math.round(quota))
  }
  return resolved
}

const capEveryYear = (value: number | undefined): Record<number, number> =>
  value === undefined
    ? {}
    : Object.fromEntries(ROTATION_CALENDAR_YEARS.map((year) => [year, value]))

// True when every year has the same cap, or none has one.
export const sameCapEveryYear = (maxNLoadByYear: Record<number, number>) =>
  ROTATION_CALENDAR_YEARS.every(
    (year) =>
      maxNLoadByYear[year] === maxNLoadByYear[ROTATION_CALENDAR_YEARS[0]],
  )

// The yearly cap of a catchment is its maks. udledning under Regler
// (averageCaps), or its kvote when Regler has none, in every year. Only a cap
// that differs between years ("Forskellig grænse pr. år") is kept as saved.
// Returns settings unchanged when nothing differs.
export const syncYearlyNLoadCaps = (
  settings: OptimizationSettings,
  fields: FieldRecord[],
  averageCaps: CatchmentNLoadCap[],
): OptimizationSettings => {
  const catchmentIds = new Set(fields.map((field) => field.catchmentId))
  const startCaps = effectiveMaxNLoadByCatchment(fields, averageCaps)
  const startCap = (catchmentId: number | null) =>
    capEveryYear(startCaps.get(catchmentKey(catchmentId)))
  let changed = false
  const kept = settings.maxNLoadByCatchment.map((cap) => {
    if (
      !catchmentIds.has(cap.catchmentId) ||
      !sameCapEveryYear(cap.maxNLoadByYear)
    )
      return cap
    const maxNLoadByYear = startCap(cap.catchmentId)
    if (
      ROTATION_CALENDAR_YEARS.every(
        (year) => cap.maxNLoadByYear[year] === maxNLoadByYear[year],
      )
    )
      return cap
    changed = true
    return { ...cap, maxNLoadByYear }
  })
  const existing = new Set(
    settings.maxNLoadByCatchment.map((cap) => cap.catchmentId),
  )
  const missing = [...catchmentIds]
    .filter((catchmentId) => !existing.has(catchmentId))
    .map((catchmentId) => ({
      catchmentId,
      maxNLoadByYear: startCap(catchmentId),
    }))
  if (!changed && missing.length === 0) return settings
  return { ...settings, maxNLoadByCatchment: [...kept, ...missing] }
}

export const useCatchmentColor = (farmId: string, fields: FieldRecord[]) => {
  const options = useCatchmentOptions(farmId, fields)
  const colorByKey = new Map(
    options.map((option) => [
      catchmentKey(option.catchmentId),
      option.colorClass,
    ]),
  )
  return (catchmentId: number | null) =>
    colorByKey.get(catchmentKey(catchmentId)) ?? NO_CATCHMENT_COLOR_CLASS
}

export const useCatchmentLabel = (farmId: string, fields: FieldRecord[]) => {
  const options = useCatchmentOptions(farmId, fields)
  const labelByKey = new Map(
    options.map((option) => [catchmentKey(option.catchmentId), option.label]),
  )
  return (catchmentId: number | null) =>
    labelByKey.get(catchmentKey(catchmentId)) ??
    describeCatchment(catchmentId, null)
}
