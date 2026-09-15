import { useMemo } from 'react'

import { useFarmEmissions } from '@/api/hooks'
import type { FieldRecord } from '@/api/types'

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
  return useMemo(() => {
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
  }, [fields, emissions])
}

export const useCatchmentColor = (farmId: string, fields: FieldRecord[]) => {
  const options = useCatchmentOptions(farmId, fields)
  return useMemo(() => {
    const colorByKey = new Map(
      options.map((option) => [
        catchmentKey(option.catchmentId),
        option.colorClass,
      ]),
    )
    return (catchmentId: number | null) =>
      colorByKey.get(catchmentKey(catchmentId)) ?? NO_CATCHMENT_COLOR_CLASS
  }, [options])
}

export const useCatchmentLabel = (farmId: string, fields: FieldRecord[]) => {
  const options = useCatchmentOptions(farmId, fields)
  return useMemo(() => {
    const labelByKey = new Map(
      options.map((option) => [catchmentKey(option.catchmentId), option.label]),
    )
    return (catchmentId: number | null) =>
      labelByKey.get(catchmentKey(catchmentId)) ??
      describeCatchment(catchmentId, null)
  }, [options])
}
