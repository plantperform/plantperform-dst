import { useState } from 'react'
import { mutate } from 'swr'

import { farmEmissionsKey, farmViewKey, simulationViewKey } from '@/api/hooks'
import { detachField, removeSimulationFields } from '@/api/mutations'
import { fieldOwnerName } from '@/lib/field-domain'

export const refreshFields = (farmId: string, simulationId?: string) =>
  (simulationId
    ? mutate(simulationViewKey(farmId, simulationId))
    : Promise.all([
        mutate(farmViewKey(farmId)),
        mutate(farmEmissionsKey(farmId)),
      ])
  ).catch(() => undefined)

const describeDetachFailure = (
  failedCount: number,
  requestedCount: number,
  owner: string,
) =>
  failedCount < requestedCount
    ? `${failedCount} af ${requestedCount} marker kunne ikke fjernes fra ${owner}.`
    : requestedCount === 1
      ? `Kunne ikke fjerne marken fra ${owner}.`
      : `Kunne ikke fjerne markerne fra ${owner}.`

const detachEach = async (farmId: string, fieldIds: string[]) => {
  const results = await Promise.allSettled(
    fieldIds.map((fieldId) => detachField(farmId, fieldId)),
  )
  return fieldIds.filter((_, index) => results[index].status === 'rejected')
}

export const useDetachFields = (
  farmId: string,
  onError: (message: string | null) => void,
  simulationId?: string,
) => {
  const [detachingFieldIds, setDetachingFieldIds] = useState<string[]>([])

  const detachFields = async (fieldIds: string[]): Promise<string[]> => {
    if (fieldIds.length === 0) return []
    setDetachingFieldIds((current) => [...current, ...fieldIds])
    const failedFieldIds = simulationId
      ? await removeSimulationFields(farmId, simulationId, fieldIds).then(
          () => [],
          () => fieldIds,
        )
      : await detachEach(farmId, fieldIds)
    await refreshFields(farmId, simulationId)
    setDetachingFieldIds((current) =>
      current.filter((fieldId) => !fieldIds.includes(fieldId)),
    )
    onError(
      failedFieldIds.length === 0
        ? null
        : describeDetachFailure(
            failedFieldIds.length,
            fieldIds.length,
            fieldOwnerName(simulationId !== undefined),
          ),
    )
    return failedFieldIds
  }

  return { detachingFieldIds, detachFields }
}
