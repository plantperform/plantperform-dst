import { useEffect, useId, useMemo, useRef, useState } from 'react'
import useSWR, { mutate, preload, useSWRConfig, type Cache } from 'swr'

import { fetcher } from '@/api/client'
import { useFieldAliases } from '@/api/field-aliases'
import { createRequestQueue } from '@/api/request-queue'
import { JOB_POLL_INTERVAL_MS, watchResultPolling } from '@/api/result-tracking'
import { isViewPreparing } from '@/api/view-cache'
import {
  useFarmView,
  useSimulationView,
  farmViewKey,
  fetchSimulationView,
  refreshFarmView,
  simulationViewKey,
} from '@/api/views'
export {
  useFarmView,
  useSimulationView,
  fetchFarmView,
  fetchSimulationView,
  farmViewKey,
  simulationViewKey,
} from '@/api/views'
import {
  isSimulationCreating,
  isSimulationReady,
} from '@/lib/simulation-creation'
import {
  applyFieldAliases,
  applySavedResultAliases,
  EMPTY_FIELD_ALIASES,
} from '@/lib/field-aliases'
import { useOptimizationRunsContext } from '@/api/optimization-runs'
import type { RequestProgress } from '@/api/request-progress'
import type {
  FieldYearValues,
  SimulationView,
  SavedResultView,
  CropAreaRange,
  CropCodeOption,
  Farm,
  FarmMember,
  FarmView,
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

export const useFarm = (farmId?: string) => {
  const response = useFarmView(farmId)
  return { ...response, data: response.data?.farm }
}

export const useFarmFields = (farmId?: string) => {
  const response = useFarmView(farmId)
  return { ...response, data: response.data?.data?.fields }
}

export type FieldsByFarmId = Partial<Record<string, FieldRecord[] | null>>

const FARM_VIEWS_AT_A_TIME = 6

const cachedFarmFields = (cache: Cache, farmId: string) => {
  const view = cache.get(farmViewKey(farmId)!)?.data as FarmView | undefined
  return view && (view.data?.fields ?? null)
}

export const useFarmsFields = (farms: Farm[]): FieldsByFarmId => {
  const { cache } = useSWRConfig()
  const [fieldsByFarmId, setFieldsByFarmId] = useState<FieldsByFarmId>(() =>
    Object.fromEntries(
      farms.map((farm) => [farm.id, cachedFarmFields(cache, farm.id)]),
    ),
  )
  const farmIds = farms.map((farm) => farm.id).join(',')
  useEffect(() => {
    if (!farmIds) return
    let open = true
    const queue = createRequestQueue(FARM_VIEWS_AT_A_TIME)
    const failed = new Set<string>()
    const load = (farmId: string) =>
      void queue(async () => {
        if (!open) return
        const fields = await refreshFarmView(cache, farmId).then(
          (view) => view.data?.fields ?? null,
          () => {
            failed.add(farmId)
            return cachedFarmFields(cache, farmId) ?? null
          },
        )
        if (!open) return
        setFieldsByFarmId((current) =>
          current[farmId] === fields
            ? current
            : { ...current, [farmId]: fields },
        )
      })
    farmIds.split(',').forEach(load)
    const stopRetrying = watchResultPolling(
      (all) => {
        if (!all) return
        const farmsToRetry = [...failed]
        failed.clear()
        farmsToRetry.forEach(load)
      },
      { window, document, navigator },
    )
    return () => {
      open = false
      stopRetrying()
    }
  }, [cache, farmIds])
  const { data: aliases = EMPTY_FIELD_ALIASES } = useFieldAliases()
  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(fieldsByFarmId).map(([id, fields]) => [
          id,
          fields ? applyFieldAliases(fields, aliases) : fields,
        ]),
      ),
    [fieldsByFarmId, aliases],
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
    refreshInterval: (data) =>
      data?.some(isSimulationCreating) ? JOB_POLL_INTERVAL_MS : 0,
  })
  const { syncSimulations } = useOptimizationRunsContext()
  useEffect(() => {
    if (!response.data) return
    syncSimulations(response.data)
    for (const simulation of response.data) {
      const ready = isSimulationReady(simulation)
      if (ready && previous.current.get(simulation.id) === false) {
        void mutate(simulationViewKey(farmId, simulation.id))
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
) => {
  const response = useSimulationView(farmId, enabled ? simulationId : undefined)
  return {
    ...response,
    data: response.data?.data?.fields,
    isLoading: response.isLoading || isViewPreparing(response.data),
    error:
      response.error ??
      (response.data?.status === 'failed'
        ? new Error('Simuleringens visning kunne ikke hentes.')
        : undefined),
    summaryMissing: response.data?.status === 'missing',
  }
}

export const fetchSimulationFields = async (
  farmId: string,
  simulationId: string,
) => (await fetchSimulationView(farmId, simulationId)).data?.fields ?? []

// Settings can be opened even when the simulation display has not been published.
export const useStoredSimulationFields = (
  farmId?: string,
  simulationId?: string,
  revision?: number,
) => {
  const response = useSWR<FieldRecord[]>(
    farmId && simulationId
      ? [
          `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/fields`,
          revision,
        ]
      : null,
    ([path]: [string, number | undefined]) => fetcher<FieldRecord[]>(path),
  )
  const { data: aliases = EMPTY_FIELD_ALIASES } = useFieldAliases()
  const data = useMemo(
    () => response.data ? applyFieldAliases(response.data, aliases) : undefined,
    [response.data, aliases],
  )
  return { ...response, data }
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
  const key = simulationViewKey(farmId, simulationId)
  return key
    ? (cache.get(key)?.data as SimulationView | undefined)?.data?.fields
    : undefined
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
  const response = useSWR<FieldsBySimulationId>(
    farmId && simulationIds.length > 0
      ? [SIMULATIONS_FIELDS_KEY, farmId, simulationIds.join(','), visitId]
      : null,
    ([, keyFarmId, joinedIds]: string[]) =>
      fetchSimulationsFields(cache, keyFarmId, joinedIds.split(',')),
  )
  const { data: aliases = EMPTY_FIELD_ALIASES } = useFieldAliases()
  const data = useMemo(
    () => response.data
      ? Object.fromEntries(Object.entries(response.data).map(([id, fields]) => [
          id,
          applyFieldAliases(fields, aliases),
        ]))
      : undefined,
    [response.data, aliases],
  )
  return { ...response, data }
}

// Comparisons use the latest saved output, including its original field inputs.
export const isSimulationResultsKey = (key: unknown, farmId: string) =>
  Array.isArray(key) && key[0] === 'simulation-results' && key[1] === farmId

export const useSimulationResults = (
  farmId: string,
  simulations: Simulation[],
) => {
  const { cache } = useSWRConfig()
  const response = useSWR<Record<string, SavedResultView | null>>(
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
          simulations.map(async (simulation) => {
            const key = simulationViewKey(farmId, simulation.id)!
            const cached = cache.get(key)?.data as SimulationView | undefined
            const saved = cached?.data?.savedResult
            const fresh =
              saved &&
              (simulation.result.status !== 'completed' ||
                saved.runId === simulation.result.runId)
            const view = fresh
              ? cached
              : await fetchSimulationView(farmId, simulation.id)
            return [simulation.id, view?.data?.savedResult ?? null] as const
          }),
        ),
      ),
  )
  const { data: aliases = EMPTY_FIELD_ALIASES } = useFieldAliases()
  const data = useMemo(
    () => response.data
      ? Object.fromEntries(Object.entries(response.data).map(([id, saved]) => [
          id,
          saved ? applySavedResultAliases(saved, aliases) : null,
        ]))
      : undefined,
    [response.data, aliases],
  )
  return { ...response, data }
}

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

export const useCropAreaRanges = (farmId?: string, simulationId?: string) => {
  const response = useSimulationView(farmId, simulationId)
  return { ...response, data: response.data?.data?.cropAreaRanges }
}

export const fetchCropAreaRanges = async (
  farmId: string,
  simulationId: string,
): Promise<CropAreaRange[]> => {
  return (
    (await fetchSimulationView(farmId, simulationId)).data?.cropAreaRanges ?? []
  )
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
export const useFieldYearValues = (
  farmId: string | undefined,
  simulationId: string | undefined,
  _fields: FieldRecord[],
  enabled: boolean,
) => {
  const farm = useFarmView(enabled && !simulationId ? farmId : undefined)
  const simulation = useSimulationView(
    enabled ? farmId : undefined,
    simulationId,
  )
  const response = simulationId ? simulation : farm
  return {
    ...response,
    data: response.data?.data?.fieldYears as FieldYearValues | undefined,
  }
}

export const useFieldYearValuesProgress = (
  farmId: string | undefined,
  simulationId: string | undefined,
  fields: FieldRecord[],
  enabled: boolean,
): RequestProgress => {
  const values = useFieldYearValues(farmId, simulationId, fields, enabled)
  return { total: fields.length, done: values.data ? fields.length : 0 }
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
) => {
  const response = useSimulationView(farmId, simulationId)
  return { ...response, data: response.data?.data?.yearlySummary }
}

export const farmHistoricalYearlySummaryKey = (farmId?: string) => {
  if (!farmId) return null

  return `/farms/${encodeURIComponent(farmId)}/fields/historical-yearly-summary`
}

export const useFarmHistoricalYearlySummary = (farmId?: string) => {
  const response = useFarmView(farmId)
  return { ...response, data: response.data?.data?.yearlySummary }
}

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

export const useRegistryFieldsBulk = (imkIds: number[]) =>
  useSWR<RegistryField[]>(registryFieldsBulkKey(imkIds), fetcher, {
    revalidateOnFocus: false,
  })

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
  nextCropCode?: number,
) => {
  if (!farmId) return null

  const params = new URLSearchParams()
  if (cropCode !== undefined) {
    params.set('hovedafgrode_kode', String(cropCode))
  }
  if (farmingSystem !== undefined) params.set('driftsform', farmingSystem)
  if (nextCropCode !== undefined) {
    params.set('naeste_afgrode_kode', String(nextCropCode))
  }
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
  nextCropCode?: number,
) =>
  useSWR<CropCodeOption[]>(
    undersownCropCodesKey(farmId, cropCode, farmingSystem, nextCropCode),
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
) => {
  const response = useSimulationView(farmId, simulationId)
  return {
    ...response,
    data: response.data?.data?.yearlyOptimizationCandidates,
  }
}
