import useSWR from 'swr'

import { fetcher } from '@/api/client'
import type {
  Farm,
  FieldRecord,
  RegistryField,
  RegistryFieldSummary,
  Simulation,
} from '@/api/types'

export const farmFieldsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/fields`
}

export const useFarms = () => useSWR<Farm[]>('/farms', fetcher)

export const farmKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}`
}

export const useFarm = (farmId?: string) =>
  useSWR<Farm>(farmKey(farmId), fetcher)

export const useFarmFields = (farmId?: string) =>
  useSWR<FieldRecord[]>(farmFieldsKey(farmId), fetcher)

export const simulationsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations`
}

export const simulationFieldsKey = (farmId?: string, simulationId?: string) => {
  if (!farmId || !simulationId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/fields`
}

export const useSimulations = (farmId?: string) =>
  useSWR<Simulation[]>(simulationsKey(farmId), fetcher)

export const useSimulationFields = (farmId?: string, simulationId?: string) =>
  useSWR<FieldRecord[]>(simulationFieldsKey(farmId, simulationId), fetcher)

export const useRegistryFieldsByCvr = (cvr?: string, limit = 100) =>
  useSWR<RegistryFieldSummary[]>(
    cvr
      ? `/registry/fields/search?cvr=${encodeURIComponent(cvr)}&limit=${limit}`
      : null,
    fetcher,
  )

export const useRegistryField = (imkId?: number) =>
  useSWR<RegistryField>(imkId ? `/registry/fields/${imkId}` : null, fetcher)

export const registryFieldsBulkKey = (imkIds: number[]) => {
  if (imkIds.length === 0) return null

  return `/registry/fields/bulk?imkIds=${imkIds.map(encodeURIComponent).join(',')}`
}
