import useSWR, { mutate, preload } from 'swr'

import { fetcher } from '@/api/client'
import type {
  AfgrodeKodeOption,
  Farm,
  FarmMember,
  FieldRecord,
  GodningPresetOption,
  KystvandoplandEmissions,
  RegistryField,
  RegistryFieldSummary,
  RotationCandidateEvaluation,
  RotationCandidateOption,
  RotationCandidateYearResult,
  RotationKategoriOption,
  Simulation,
  YearlyOptimizationKategoriOption,
  YearlySummaryEntry,
} from '@/api/types'

export const farmFieldsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/fields`
}

export const farmsKey = '/farms'

export const useFarms = () => useSWR<Farm[]>(farmsKey, fetcher)

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

export const farmEmissionsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/udledning-per-kystvandopland`
}

export const useFarmEmissions = (farmId?: string) =>
  useSWR<KystvandoplandEmissions[]>(farmEmissionsKey(farmId), fetcher)

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

export const scenarioAfgrodeKoderKey = (
  farmId?: string,
  simulationId?: string,
) => {
  if (!farmId || !simulationId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/afgroder-i-brug`
}

export const useScenarioAfgrodeKoder = (
  farmId?: string,
  simulationId?: string,
) =>
  useSWR<AfgrodeKodeOption[]>(
    scenarioAfgrodeKoderKey(farmId, simulationId),
    fetcher,
  )

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

export const fieldHistoricalDetailKey = (farmId?: string, fieldId?: string) => {
  if (!farmId || !fieldId) return null

  return `/farms/${encodeURIComponent(farmId)}/fields/${encodeURIComponent(fieldId)}/historical-detail`
}

export const useFieldHistoricalDetail = (farmId?: string, fieldId?: string) =>
  useSWR<RotationCandidateYearResult[]>(
    fieldHistoricalDetailKey(farmId, fieldId),
    fetcher,
  )
export type SimulationFieldYearValues = Record<
  string,
  RotationCandidateYearResult[]
>

const YEAR_VALUES_CONCURRENCY = 6

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await run(items[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return results
}

const yearValuesByFieldRotation = new Map<
  string,
  RotationCandidateYearResult[]
>()

const fetchSimulationFieldYearValues = async (
  farmId: string,
  simulationId: string,
  fieldEntries: string[],
): Promise<SimulationFieldYearValues> => {
  const result: SimulationFieldYearValues = {}
  const missing: { fieldId: string; cacheKey: string }[] = []
  for (const entry of fieldEntries) {
    const fieldId = entry.split(':')[0]
    const cacheKey = `${farmId}/${simulationId}/${entry}`
    const cached = yearValuesByFieldRotation.get(cacheKey)
    if (cached) {
      result[fieldId] = cached
    } else {
      missing.push({ fieldId, cacheKey })
    }
  }
  await mapWithConcurrency(
    missing,
    YEAR_VALUES_CONCURRENCY,
    async ({ fieldId, cacheKey }) => {
      const key = simulationFieldCandidateDetailKey(farmId, simulationId, fieldId)
      if (!key) return
      try {
        const detail = await mutate<RotationCandidateEvaluation>(
          key,
          fetcher<RotationCandidateEvaluation>(key),
          { revalidate: false },
        )
        if (!detail) return
        const years = detail.years.slice(0, detail.activeLen)
        yearValuesByFieldRotation.set(cacheKey, years)
        result[fieldId] = years
      } catch {
        return
      }
    },
  )
  return result
}

export const useSimulationFieldYearValues = (
  farmId: string | undefined,
  simulationId: string | undefined,
  fields: FieldRecord[],
  enabled: boolean,
) => {
  const fieldIds = fields
    .filter((field) => field.rotationId !== null)
    .map((field) => `${field.id}:${field.rotationId}`)
    .sort()
  const key =
    enabled && farmId && simulationId && fieldIds.length > 0
      ? ['simulation-field-year-values', farmId, simulationId, fieldIds.join(',')]
      : null
  return useSWR<SimulationFieldYearValues>(
    key,
    ([, keyFarmId, keySimulationId, joinedIds]: string[]) =>
      fetchSimulationFieldYearValues(
        keyFarmId,
        keySimulationId,
        joinedIds.split(','),
      ),
    { revalidateOnFocus: false, revalidateIfStale: false },
  )
}

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

export const farmHistoricalYearlySummaryKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/fields/historical-yearly-summary`
}

export const useFarmHistoricalYearlySummary = (farmId?: string) =>
  useSWR<YearlySummaryEntry[]>(farmHistoricalYearlySummaryKey(farmId), fetcher)

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
