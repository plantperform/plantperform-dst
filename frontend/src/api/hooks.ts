import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import useSWR, { mutate, preload, useSWRConfig, type Cache } from 'swr'

import { fetcher } from '@/api/client'
import { isSimulationCreating, isSimulationReady } from '@/lib/simulation-creation'
import { useOptimizationRunsContext } from '@/api/optimization-runs'
import {
  createRequestProgress,
  type RequestProgress,
} from '@/api/request-progress'
import { createRequestQueue } from '@/api/request-queue'
import type {
  FieldYearValues,
  CropAreaRange,
  CropCodeOption,
  Farm,
  FarmMember,
  FieldRecord,
  FertiliserPresetOption,
  CatchmentEmissions,
  RegistryField,
  RegistryFieldSummary,
  RotationCandidateEvaluation,
  RotationCandidateOption,
  RotationCandidateYearResult,
  RotationCategoryOption,
  Simulation,
  SimulationResult,
  YearlyOptimizationCategoryOption,
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

export type FieldsByFarmId = Record<string, FieldRecord[]>

const fetchFarmsFields = async (farmIds: string[]): Promise<FieldsByFarmId> => {
  const entries = await Promise.all(
    farmIds.map(async (farmId) => {
      const key = farmFieldsKey(farmId)
      const fields = key
        ? await mutate<FieldRecord[]>(key, fetcher<FieldRecord[]>(key), {
            revalidate: false,
          })
        : undefined
      return [farmId, fields ?? []] as const
    }),
  )
  return Object.fromEntries(entries)
}

export const useFarmsFields = (farms: Farm[] | undefined) => {
  const farmIds = (farms ?? []).map((farm) => farm.id).sort()
  return useSWR<FieldsByFarmId>(
    farmIds.length > 0 ? ['farms-fields', farmIds.join(',')] : null,
    ([, joinedIds]: string[]) => fetchFarmsFields(joinedIds.split(',')),
    { revalidateOnFocus: false },
  )
}

export const farmEmissionsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/udledning-per-kystvandopland`
}

export const useFarmEmissions = (farmId?: string) =>
  useSWR<CatchmentEmissions[]>(farmEmissionsKey(farmId), fetcher)

export const simulationsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations`
}

export const simulationFieldsKey = (farmId?: string, simulationId?: string) => {
  if (!farmId || !simulationId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/fields`
}

export const useSimulations = (farmId?: string) => {
  const previous = useRef(new Map<string, boolean>())
  const response = useSWR<Simulation[]>(simulationsKey(farmId), fetcher, {
    refreshInterval: (data) => (data?.some(isSimulationCreating) ? 5000 : 0),
  })
  const { syncSimulations } = useOptimizationRunsContext()
  useEffect(() => {
    if (!response.data) return
    syncSimulations(response.data)
    for (const simulation of response.data) {
      const ready = isSimulationReady(simulation)
      if (ready && previous.current.get(simulation.id) === false) {
        void mutate(simulationFieldsKey(farmId, simulation.id))
      }
      previous.current.set(simulation.id, ready)
    }
  }, [farmId, response.data, syncSimulations])
  return response
}

export const useSimulationFields = (
  farmId?: string,
  simulationId?: string,
  enabled = true,
) =>
  useSWR<FieldRecord[]>(
    enabled ? simulationFieldsKey(farmId, simulationId) : null, fetcher,
  )

export const fetchSimulationFields = async (
  farmId: string,
  simulationId: string,
): Promise<FieldRecord[]> => {
  const key = simulationFieldsKey(farmId, simulationId)
  if (!key) return []
  const fields = await mutate<FieldRecord[]>(key, fetcher<FieldRecord[]>(key), {
    revalidate: false,
  })
  return fields ?? []
}

export type FieldsBySimulationId = Record<string, FieldRecord[]>

const SIMULATIONS_FIELDS_KEY = 'simulations-fields'

export const isSimulationsFieldsKey = (
  key: unknown,
  farmId: string,
): key is unknown[] =>
  Array.isArray(key) && key[0] === SIMULATIONS_FIELDS_KEY && key[1] === farmId

const cachedSimulationFields = (
  cache: Cache,
  farmId: string,
  simulationId: string,
): FieldRecord[] | undefined => {
  const key = simulationFieldsKey(farmId, simulationId)
  return key ? cache.get(key)?.data : undefined
}

const fetchSimulationsFields = async (
  cache: Cache,
  farmId: string,
  simulationIds: string[],
): Promise<FieldsBySimulationId> => {
  const entries = await Promise.all(
    simulationIds.map(
      async (simulationId) =>
        [
          simulationId,
          cachedSimulationFields(cache, farmId, simulationId) ??
            (await fetchSimulationFields(farmId, simulationId)),
        ] as const,
    ),
  )
  return Object.fromEntries(entries)
}

export const useSimulationsFields = (
  farmId: string | undefined,
  simulations: Simulation[],
) => {
  const { cache } = useSWRConfig()
  const visitId = useId()
  const simulationIds = simulations
    .filter(isSimulationReady)
    .map((simulation) => simulation.id)
    .sort()
  useEffect(() => {
    if (!farmId) return
    void mutate(
      (key) => isSimulationsFieldsKey(key, farmId) && key[3] !== visitId,
      undefined,
      { revalidate: false },
    )
  }, [farmId, visitId])
  return useSWR<FieldsBySimulationId>(
    farmId && simulationIds.length > 0
      ? [SIMULATIONS_FIELDS_KEY, farmId, simulationIds.join(','), visitId]
      : null,
    ([, keyFarmId, joinedIds]: string[]) =>
      fetchSimulationsFields(cache, keyFarmId, joinedIds.split(',')),
  )
}

// Comparisons use the latest saved output, including its original field inputs.
export const isSimulationResultsKey = (key: unknown, farmId: string) =>
  Array.isArray(key) && key[0] === 'simulation-results' && key[1] === farmId

export const useSimulationResults = (
  farmId: string,
  simulations: Simulation[],
) =>
  useSWR<Record<string, SimulationResult>>(
    simulations.length
      ? [
          'simulation-results',
          farmId,
          simulations
            .map(
              (s) =>
                `${s.id}:${s.result.runId}:${s.result.status}:${s.result.resultRevision}`,
            )
            .sort()
            .join(','),
        ]
      : null,
    async () =>
      Object.fromEntries(
        await Promise.all(
          simulations.map(
            async (simulation) =>
              [
                simulation.id,
                await fetcher<SimulationResult>(
                  `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulation.id)}/result`,
                ),
              ] as const,
          ),
        ),
      ),
  )

export const scenarioCropCodesKey = (
  farmId?: string,
  simulationId?: string,
) => {
  if (!farmId || !simulationId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/afgroder-i-brug`
}

export const useScenarioCropCodes = (farmId?: string, simulationId?: string) =>
  useSWR<CropCodeOption[]>(scenarioCropCodesKey(farmId, simulationId), fetcher)

export const cropAreaRangesKey = (farmId?: string, simulationId?: string) => {
  if (!farmId || !simulationId) return null

  return `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/crop-area-ranges`
}

export const useCropAreaRanges = (farmId?: string, simulationId?: string) =>
  useSWR<CropAreaRange[]>(cropAreaRangesKey(farmId, simulationId), fetcher)

export const fetchCropAreaRanges = async (
  farmId: string,
  simulationId: string,
): Promise<CropAreaRange[]> => {
  const key = cropAreaRangesKey(farmId, simulationId)
  if (!key) return []
  const ranges = await mutate<CropAreaRange[]>(
    key,
    fetcher<CropAreaRange[]>(key),
    { revalidate: false },
  )
  return ranges ?? []
}

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
const YEAR_VALUES_CONCURRENCY = 6

const queueYearValuesRequest = createRequestQueue(YEAR_VALUES_CONCURRENCY)

const requestProgress = createRequestProgress()

const yearValuesCache = new Map<string, RotationCandidateYearResult[]>()

type YearValuesSource = {
  cacheKey: (fieldId: string, entry: string) => string
  load: (fieldId: string) => Promise<RotationCandidateYearResult[] | undefined>
}

const simulationYearValuesSource = (
  farmId: string,
  simulationId: string,
): YearValuesSource => ({
  cacheKey: (_fieldId, entry) => `${farmId}/${simulationId}/${entry}`,
  load: async (fieldId) => {
    const key = simulationFieldCandidateDetailKey(farmId, simulationId, fieldId)
    if (!key) return undefined
    const detail = await mutate<RotationCandidateEvaluation>(
      key,
      fetcher<RotationCandidateEvaluation>(key),
      { revalidate: false },
    )
    return detail ? detail.years.slice(0, detail.activeLen) : undefined
  },
})

const historyYearValuesSource = (farmId: string): YearValuesSource => ({
  cacheKey: (fieldId) => `${farmId}/history/${fieldId}`,
  load: async (fieldId) => {
    const key = fieldHistoricalDetailKey(farmId, fieldId)
    if (!key) return undefined
    return mutate<RotationCandidateYearResult[]>(
      key,
      fetcher<RotationCandidateYearResult[]>(key),
      { revalidate: false },
    )
  },
})

const fetchFieldYearValues = async (
  entries: string[],
  source: YearValuesSource,
  progressKey: string,
): Promise<FieldYearValues> => {
  const result: FieldYearValues = {}
  const missing: { fieldId: string; cacheKey: string }[] = []
  for (const entry of entries) {
    const fieldId = entry.split(':')[0]
    const cacheKey = source.cacheKey(fieldId, entry)
    const cached = yearValuesCache.get(cacheKey)
    if (cached) {
      result[fieldId] = cached
    } else {
      missing.push({ fieldId, cacheKey })
    }
  }
  requestProgress.start(
    progressKey,
    entries.length,
    entries.length - missing.length,
  )
  await Promise.all(
    missing.map(({ fieldId, cacheKey }) =>
      queueYearValuesRequest(async () => {
        try {
          const years = await source.load(fieldId)
          if (!years) return
          yearValuesCache.set(cacheKey, years)
          result[fieldId] = years
        } catch {
          return
        } finally {
          requestProgress.advance(progressKey)
        }
      }),
    ),
  )
  requestProgress.finish(progressKey)
  return result
}

const fieldYearValuesEntries = (
  simulationId: string | undefined,
  fields: FieldRecord[],
) =>
  (simulationId
    ? fields
        .filter((field) => field.rotationId !== null)
        .map((field) => `${field.id}:${field.rotationId}`)
    : fields.map((field) => field.id)
  ).sort()

const fieldYearValuesKey = (
  farmId: string | undefined,
  simulationId: string | undefined,
  entries: string[],
  enabled: boolean,
) =>
  enabled && farmId && entries.length > 0
    ? ['field-year-values', farmId, simulationId ?? '', entries.join(',')]
    : null

export const useFieldYearValues = (
  farmId: string | undefined,
  simulationId: string | undefined,
  fields: FieldRecord[],
  enabled: boolean,
) =>
  useSWR<FieldYearValues>(
    fieldYearValuesKey(
      farmId,
      simulationId,
      fieldYearValuesEntries(simulationId, fields),
      enabled,
    ),
    (key: string[]) => {
      const [, keyFarmId, keySimulationId, joinedEntries] = key
      return fetchFieldYearValues(
        joinedEntries.split(','),
        keySimulationId
          ? simulationYearValuesSource(keyFarmId, keySimulationId)
          : historyYearValuesSource(keyFarmId),
        key.join('|'),
      )
    },
    { revalidateOnFocus: false, revalidateIfStale: false },
  )

export const useFieldYearValuesProgress = (
  farmId: string | undefined,
  simulationId: string | undefined,
  fields: FieldRecord[],
  enabled: boolean,
): RequestProgress => {
  const entries = fieldYearValuesEntries(simulationId, fields)
  const key = fieldYearValuesKey(farmId, simulationId, entries, enabled)
  const running = useSyncExternalStore(requestProgress.subscribe, () =>
    key === null ? undefined : requestProgress.get(key.join('|')),
  )
  return {
    done: running?.done ?? 0,
    total: key === null ? 0 : entries.length,
  }
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

export const rotationCategoriesKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates/kategorier`
}

export const useRotationCategories = (farmId?: string) =>
  useSWR<RotationCategoryOption[]>(rotationCategoriesKey(farmId), fetcher)

export const rotationNNormPercentagesKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates/n-norm-procenter`
}

export const useRotationNNormPercentages = (farmId?: string) =>
  useSWR<string[]>(rotationNNormPercentagesKey(farmId), fetcher)

export const cropCodesKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates/afgrode-koder`
}

export const useCropCodes = (farmId?: string) =>
  useSWR<CropCodeOption[]>(cropCodesKey(farmId), fetcher)

export const undersownCropCodesKey = (
  farmId?: string,
  cropCode?: number,
  farmingSystem?: string,
) => {
  if (!farmId) return null

  const params = new URLSearchParams()
  if (cropCode !== undefined) {
    params.set('hovedafgrode_kode', String(cropCode))
  }
  if (farmingSystem !== undefined) params.set('driftsform', farmingSystem)
  const query = params.toString()

  return (
    `/farms/${encodeURIComponent(farmId)}/rotation-candidates/udlaeg-koder` +
    (query ? `?${query}` : '')
  )
}

export const useUndersownCropCodes = (
  farmId?: string,
  cropCode?: number,
  farmingSystem?: string,
) =>
  useSWR<CropCodeOption[]>(
    undersownCropCodesKey(farmId, cropCode, farmingSystem),
    fetcher,
  )

export const preloadRotationCandidateCatalog = (farmId: string) => {
  void preload(rotationCategoriesKey(farmId), fetcher)
  void preload(rotationCandidatesKey(farmId), fetcher)
  void preload(cropCodesKey(farmId), fetcher)
  void preload(undersownCropCodesKey(farmId), fetcher)
}

export const fertiliserPresetsKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/rotation-candidates/godnings-presets`
}

export const useFertiliserPresets = (farmId?: string) =>
  useSWR<FertiliserPresetOption[]>(fertiliserPresetsKey(farmId), fetcher)

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
  useSWR<YearlyOptimizationCategoryOption[]>(
    yearlyOptimizationCandidatesKey(farmId, simulationId),
    fetcher,
  )
