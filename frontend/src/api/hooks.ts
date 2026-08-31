import useSWR, { preload } from 'swr'

import { fetcher } from '@/api/client'
import type {
  AfgrodeKodeOption,
  Farm,
  FarmMember,
  FieldRecord,
  GodningPresetOption,
  RegistryField,
  RegistryFieldSummary,
  RotationCandidateEvaluation,
  RotationCandidateOption,
  RotationKategoriOption,
  Simulation,
  YearlyOptimizationKategoriOption,
  YearlySummaryEntry,
} from '@/api/types'

export const farmFieldsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/fields`
}

export const useFarms = () => useSWR<Farm[]>('/farms', fetcher)

export const farmMembersKey = (farmId?: string) => {
  if (!farmId) return null
  return `/farms/${encodeURIComponent(farmId)}/members`
}

export const useFarmMembers = (farmId?: string) =>
  useSWR<FarmMember[]>(farmMembersKey(farmId), fetcher)

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

export const simulationFieldCandidateDetailKey = (
  farmId?: string,
  simulationId?: string,
  fieldId?: string,
) => {
  if (!farmId || !simulationId || !fieldId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/fields/${encodeURIComponent(fieldId)}/candidate-detail`
}

export const useSimulationFieldCandidateDetail = (
  farmId?: string,
  simulationId?: string,
  fieldId?: string,
) =>
  useSWR<RotationCandidateEvaluation>(
    simulationFieldCandidateDetailKey(farmId, simulationId, fieldId),
    fetcher,
  )

export const simulationYearlySummaryKey = (
  farmId?: string,
  simulationId?: string,
) => {
  if (!farmId || !simulationId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/yearly-summary`
}

export const useSimulationYearlySummary = (
  farmId?: string,
  simulationId?: string,
) =>
  useSWR<YearlySummaryEntry[]>(
    simulationYearlySummaryKey(farmId, simulationId),
    fetcher,
  )

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

export const rotationCandidatesKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates`
}

export const useRotationCandidateOptions = (farmId?: string) =>
  useSWR<RotationCandidateOption[]>(rotationCandidatesKey(farmId), fetcher)

export const rotationKategorierKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates/kategorier`
}

export const useRotationKategorier = (farmId?: string) =>
  useSWR<RotationKategoriOption[]>(rotationKategorierKey(farmId), fetcher)

export const rotationNNormProcenterKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates/n-norm-procenter`
}

export const useRotationNNormProcenter = (farmId?: string) =>
  useSWR<string[]>(rotationNNormProcenterKey(farmId), fetcher)

export const afgrodeKoderKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates/afgrode-koder`
}

export const useAfgrodeKoder = (farmId?: string) =>
  useSWR<AfgrodeKodeOption[]>(afgrodeKoderKey(farmId), fetcher)

export const preloadRotationCandidateCatalog = (farmId: string) => {
  void preload(rotationKategorierKey(farmId), fetcher)
  void preload(rotationCandidatesKey(farmId), fetcher)
  void preload(afgrodeKoderKey(farmId), fetcher)
}

export const godningsPresetsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates/godnings-presets`
}

export const useGodningsPresets = (farmId?: string) =>
  useSWR<GodningPresetOption[]>(godningsPresetsKey(farmId), fetcher)

export const yearlyOptimizationCandidatesKey = (
  farmId?: string,
  simulationId?: string,
) => {
  if (!farmId || !simulationId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/yearly-optimization-candidates`
}

export const useYearlyOptimizationCandidates = (
  farmId?: string,
  simulationId?: string,
) =>
  useSWR<YearlyOptimizationKategoriOption[]>(
    yearlyOptimizationCandidatesKey(farmId, simulationId),
    fetcher,
  )
