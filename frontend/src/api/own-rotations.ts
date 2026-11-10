import useSWR, { useSWRConfig } from 'swr'

import { deleteJson, fetcher, patchJson, postJson } from '@/api/client'
import { undersownCropCodesKey } from '@/api/hooks'
import type {
  CropCodeOption,
  FarmingSystem,
  RotationDefinition,
  RotationDefinitionInput,
} from '@/api/types'

const rotationDefinitionsKey = '/saedskifte-rotations'

export const ownRotationDefinitionsKey = `${rotationDefinitionsKey}?standard=false`

const libraryRotationDefinitionsKey = `${rotationDefinitionsKey}?standard=true`

const REFERENCE_OPTIONS = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
}

const definitionPath = (definitionId: string) =>
  `${rotationDefinitionsKey}/${encodeURIComponent(definitionId)}`

export const useOwnRotationDefinitions = () =>
  useSWR<RotationDefinition[]>(ownRotationDefinitionsKey, fetcher)

export const useLibraryRotationDefinitions = (enabled = true) =>
  useSWR<RotationDefinition[]>(
    enabled ? libraryRotationDefinitionsKey : null,
    fetcher,
    REFERENCE_OPTIONS,
  )

export const useUndersownCropCodeLoader = (farmId: string) => {
  const { cache, mutate } = useSWRConfig()
  return async (
    cropCode: number,
    farmingSystem: FarmingSystem | null,
    nextCropCode: number,
  ): Promise<CropCodeOption[]> => {
    const key = undersownCropCodesKey(
      farmId,
      cropCode,
      farmingSystem ?? undefined,
      nextCropCode,
    )
    if (key === null) return []
    const cached = cache.get(key)?.data as CropCodeOption[] | undefined
    if (cached) return cached
    const loaded = await mutate<CropCodeOption[]>(
      key,
      fetcher<CropCodeOption[]>(key),
      { revalidate: false },
    )
    return loaded ?? []
  }
}

export const createRotationDefinition = (input: RotationDefinitionInput) =>
  postJson<RotationDefinition, RotationDefinitionInput>(
    rotationDefinitionsKey,
    input,
  )

type RotationDefinitionUpdate = Partial<RotationDefinitionInput> & {
  expectedRevision: number
}

export const updateRotationDefinition = (
  definitionId: string,
  input: RotationDefinitionUpdate,
) =>
  patchJson<RotationDefinition, RotationDefinitionUpdate>(
    definitionPath(definitionId),
    input,
  )

export const deleteRotationDefinition = (definitionId: string) =>
  deleteJson(definitionPath(definitionId))

export const duplicateRotationDefinition = (
  definitionId: string,
  name: string,
) =>
  postJson<RotationDefinition, { name: string }>(
    `${definitionPath(definitionId)}/duplicate`,
    { name },
  )

export const rotationDefinitionMembersPath = (definitionId: string) =>
  `${definitionPath(definitionId)}/members`
