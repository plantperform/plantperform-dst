import useSWR, { useSWRConfig } from 'swr'

import { fetcher, patchJson } from '@/api/client'
import type { FieldAlias, FieldAliases } from '@/api/types'
import { useAuth } from '@/auth/context'

export const fieldAliasesKey = (email?: string) =>
  email ? (['field-aliases', email] as const) : null

export const useFieldAliases = () => {
  const { user } = useAuth()
  const key = fieldAliasesKey(user?.email)
  const response = useSWR<FieldAliases>(key, () => fetcher('/field-aliases'))
  const { mutate } = useSWRConfig()

  const saveAlias = async (
    farmId: string,
    fieldId: string,
    alias: string | null,
    simulationId?: string,
  ) => {
    if (!key) throw new Error('Log ind for at ændre markens alias.')
    const query = simulationId
      ? `?simulation_id=${encodeURIComponent(simulationId)}`
      : ''
    const result = await patchJson<FieldAlias, { alias: string | null }>(
      `/farms/${encodeURIComponent(farmId)}/fields/${encodeURIComponent(fieldId)}/alias${query}`,
      { alias },
    )
    await mutate(
      key,
      (current: FieldAliases = {}) => {
        const next = { ...current }
        if (result.alias === null) delete next[result.fieldKey]
        else next[result.fieldKey] = result.alias
        return next
      },
      { revalidate: false },
    )
    return result
  }

  return { ...response, saveAlias }
}
