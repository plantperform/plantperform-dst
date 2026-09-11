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
  kystvandId: number | null
  label: string
  colorClass: string
}

const CATCHMENT_COLOR_CLASSES = [
  'bg-sky-500',
  'bg-red-500',
  'bg-yellow-400',
  'bg-lime-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-orange-500',
  'bg-teal-500',
]

const NO_CATCHMENT_COLOR_CLASS = 'bg-stone-400'

export const catchmentKey = (kystvandId: number | null) =>
  String(kystvandId ?? 'none')

export const fieldInCatchment = (
  field: Pick<FieldRecord, 'kystvandId'>,
  key: string | null,
) => catchmentKey(field.kystvandId) === key

export const describeCatchment = (
  kystvandId: number | null,
  name: string | null | undefined,
): string =>
  kystvandId === null
    ? 'Uden kystvandopland'
    : (name ?? `Kystvandopland ${kystvandId}`)

export const useCatchmentOptions = (
  farmId: string,
  fields: FieldRecord[],
): CatchmentOption[] => {
  const { data: emissions = [] } = useFarmEmissions(farmId)
  return useMemo(() => {
    const nameById = new Map(
      emissions.map((u) => [u.kystvandId, u.kystvandNavn]),
    )
    const seen = new Map<string, Omit<CatchmentOption, 'colorClass'>>()
    for (const field of fields) {
      const key = catchmentKey(field.kystvandId)
      if (seen.has(key)) continue
      const label = describeCatchment(
        field.kystvandId,
        nameById.get(field.kystvandId),
      )
      seen.set(key, { kystvandId: field.kystvandId, label })
    }
    const sorted = Array.from(seen.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'da'),
    )
    const withCatchment = sorted.filter((option) => option.kystvandId !== null)
    return sorted.map((option) => ({
      ...option,
      colorClass:
        option.kystvandId === null
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
        catchmentKey(option.kystvandId),
        option.colorClass,
      ]),
    )
    return (kystvandId: number | null) =>
      colorByKey.get(catchmentKey(kystvandId)) ?? NO_CATCHMENT_COLOR_CLASS
  }, [options])
}

export const useCatchmentLabel = (farmId: string, fields: FieldRecord[]) => {
  const options = useCatchmentOptions(farmId, fields)
  return useMemo(() => {
    const labelByKey = new Map(
      options.map((option) => [catchmentKey(option.kystvandId), option.label]),
    )
    return (kystvandId: number | null) =>
      labelByKey.get(catchmentKey(kystvandId)) ??
      describeCatchment(kystvandId, null)
  }, [options])
}
