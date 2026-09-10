import { useMemo } from 'react'

import { useFarmEmissions } from '@/api/hooks'
import type { FieldRecord } from '@/api/types'

export const numberToInput = (value: number | null) =>
  value === null ? '' : String(value)

export const inputToOptionalNumber = (value: string) => {
  const trimmed = value.trim()
  return trimmed === '' ? null : Number(trimmed)
}

export type CatchmentOption = { kystvandId: number | null; label: string }

export const catchmentKey = (kystvandId: number | null) =>
  String(kystvandId ?? 'none')

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
    const seen = new Map<string, CatchmentOption>()
    for (const field of fields) {
      const key = catchmentKey(field.kystvandId)
      if (seen.has(key)) continue
      const label = describeCatchment(
        field.kystvandId,
        nameById.get(field.kystvandId),
      )
      seen.set(key, { kystvandId: field.kystvandId, label })
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'da'),
    )
  }, [fields, emissions])
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
