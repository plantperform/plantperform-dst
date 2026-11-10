import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { ApiError } from '@/api/client'
import { isSimulationKey } from '@/api/hooks'
import {
  createRotationDefinition,
  deleteRotationDefinition,
  duplicateRotationDefinition,
  ownRotationDefinitionsKey,
  updateRotationDefinition,
  useOwnRotationDefinitions,
} from '@/api/own-rotations'
import type { RotationDefinition } from '@/api/types'
import { useToast } from '@/components/toast'
import { freeName } from '@/lib/economics-profiles'
import {
  definitionInputFromDraft,
  type OwnRotationDraft,
} from '@/lib/own-rotations'

export const NEW_OWN_ROTATION_ID = 'new'

export const ownRotationsPath = (farmId: string) =>
  `/farms/${farmId}/own-rotations`

export const ownRotationPath = (farmId: string, definitionId: string) =>
  `${ownRotationsPath(farmId)}/${encodeURIComponent(definitionId)}`

export type SaveFailure =
  | { conflict: true }
  | { conflict: false; message: string }

const isRotationCatalogKey = (key: unknown) =>
  typeof key === 'string' &&
  /^\/farms\/[^/]+\/rotation-candidates(\/kategorier)?(\?|$)/.test(key)

const refreshRotationCatalogs = () => {
  void mutate(isRotationCatalogKey)
}

const storeDefinition = (definition: RotationDefinition) =>
  mutate<RotationDefinition[]>(
    ownRotationDefinitionsKey,
    (current) => {
      if (current === undefined) return current
      return current.some((entry) => entry.id === definition.id)
        ? current.map((entry) =>
            entry.id === definition.id ? definition : entry,
          )
        : [...current, definition]
    },
    { revalidate: false },
  )

export const forgetDefinition = async (definitionId: string) => {
  await mutate<RotationDefinition[]>(
    ownRotationDefinitionsKey,
    (current) => current?.filter((entry) => entry.id !== definitionId),
    { revalidate: false },
  )
  refreshRotationCatalogs()
}

export const ROTATION_GONE =
  'Sædskiftet findes ikke længere, eller du har ikke adgang til det.'

const statusOf = (error: unknown) =>
  error instanceof ApiError ? error.status : null

const saveFailure = (error: unknown): SaveFailure => {
  const status = statusOf(error)
  if (status === 409) return { conflict: true }
  const message =
    status === 404
      ? ROTATION_GONE
      : status === 422
        ? 'Sædskiftet kunne ikke gemmes. Tjek, at virkemidlerne passer til afgrøderne.'
        : 'Sædskiftet kunne ikke gemmes. Prøv igen.'
  return { message, conflict: false }
}

const deleteFailure = (error: unknown): string => {
  const status = statusOf(error)
  if (status === 409) {
    return 'En simulering med sædskiftet bliver regnet lige nu. Prøv igen om lidt.'
  }
  if (status === 404) return 'Sædskiftet findes ikke længere.'
  return 'Sædskiftet kunne ikke slettes. Prøv igen.'
}

const copyFailure = (
  error: unknown,
  definition: RotationDefinition,
): string => {
  if (statusOf(error) !== 404) return 'Kopien kunne ikke laves. Prøv igen.'
  return definition.isStandard
    ? 'Sædskiftet kan ikke kopieres. Et sædskifte fra biblioteket skal være valgt i en af dine simuleringer.'
    : ROTATION_GONE
}

export const useOwnRotationActions = (farmId: string) => {
  const navigate = useNavigate()
  const { showToast, showError } = useToast()
  const definitions = useOwnRotationDefinitions().data
  const [copyingId, setCopyingId] = useState<string | null>(null)

  const create = async (
    draft: OwnRotationDraft,
  ): Promise<SaveFailure | null> => {
    try {
      const created = await createRotationDefinition(
        definitionInputFromDraft(draft),
      )
      await storeDefinition(created)
      refreshRotationCatalogs()
      showToast(`${created.name} er oprettet`)
      navigate(ownRotationPath(farmId, created.id), { replace: true })
      return null
    } catch (error) {
      return saveFailure(error)
    }
  }

  const save = async (
    definition: RotationDefinition,
    draft: OwnRotationDraft,
  ): Promise<RotationDefinition | SaveFailure> => {
    try {
      const saved = await updateRotationDefinition(definition.id, {
        expectedRevision: definition.revision,
        ...definitionInputFromDraft(draft),
      })
      await storeDefinition(saved)
      refreshRotationCatalogs()
      void mutate(isSimulationKey)
      showToast(`${saved.name} er gemt`)
      return saved
    } catch (error) {
      if (statusOf(error) === 404) {
        showError(ROTATION_GONE)
        await forgetDefinition(definition.id)
      }
      return saveFailure(error)
    }
  }

  const reload = () => mutate<RotationDefinition[]>(ownRotationDefinitionsKey)

  const remove = async (definition: RotationDefinition): Promise<boolean> => {
    try {
      await deleteRotationDefinition(definition.id)
      await forgetDefinition(definition.id)
      void mutate(isSimulationKey)
      showToast(`${definition.name} er slettet`)
      return true
    } catch (error) {
      if (statusOf(error) === 404) await forgetDefinition(definition.id)
      showError(deleteFailure(error))
      return false
    }
  }

  const copy = async (
    definition: RotationDefinition,
    onCopied?: () => void,
  ): Promise<boolean> => {
    setCopyingId(definition.id)
    try {
      const copied = await duplicateRotationDefinition(
        definition.id,
        freeName(definitions ?? [], `Kopi af ${definition.name}`),
      )
      await storeDefinition(copied)
      refreshRotationCatalogs()
      showToast(`${copied.name} er oprettet`)
      onCopied?.()
      navigate(ownRotationPath(farmId, copied.id))
      return true
    } catch (error) {
      if (statusOf(error) === 404 && !definition.isStandard) {
        await forgetDefinition(definition.id)
      }
      showError(copyFailure(error, definition))
      return false
    } finally {
      setCopyingId(null)
    }
  }

  return { create, save, reload, remove, copy, copyingId }
}
