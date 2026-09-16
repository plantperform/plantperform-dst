import { useCallback, useState } from 'react'
import { mutate } from 'swr'

import {
  farmEmissionsKey,
  farmFieldsKey,
  farmHistoricalYearlySummaryKey,
  farmKey,
} from '@/api/hooks'
import { detachField } from '@/api/mutations'

export const refreshFarmFields = (farmId: string) =>
  Promise.all([
    mutate(farmFieldsKey(farmId)),
    mutate(farmKey(farmId)),
    mutate(farmEmissionsKey(farmId)),
    mutate(farmHistoricalYearlySummaryKey(farmId)),
  ]).catch(() => undefined)

const describeDetachFailure = (failedCount: number, requestedCount: number) =>
  failedCount < requestedCount
    ? `${failedCount} af ${requestedCount} marker kunne ikke fjernes fra bedriften.`
    : requestedCount === 1
      ? 'Kunne ikke fjerne marken fra bedriften.'
      : 'Kunne ikke fjerne markerne fra bedriften.'

export const useDetachFields = (
  farmId: string,
  onError: (message: string | null) => void,
) => {
  const [detachingFieldIds, setDetachingFieldIds] = useState<string[]>([])

  const detachFields = useCallback(
    async (fieldIds: string[]): Promise<string[]> => {
      if (fieldIds.length === 0) return []
      setDetachingFieldIds((current) => [...current, ...fieldIds])
      const results = await Promise.allSettled(
        fieldIds.map((fieldId) => detachField(farmId, fieldId)),
      )
      const failedFieldIds = fieldIds.filter(
        (_, index) => results[index].status === 'rejected',
      )
      await refreshFarmFields(farmId)
      setDetachingFieldIds((current) =>
        current.filter((fieldId) => !fieldIds.includes(fieldId)),
      )
      onError(
        failedFieldIds.length === 0
          ? null
          : describeDetachFailure(failedFieldIds.length, fieldIds.length),
      )
      return failedFieldIds
    },
    [farmId, onError],
  )

  return { detachingFieldIds, detachFields }
}
