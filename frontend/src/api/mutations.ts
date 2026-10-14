import { deleteJson, fetcher, patchJson, postJson } from '@/api/client'
import { registryFieldsBulkKey } from '@/api/hooks'
import {
  optimizeSimulationInput,
  yearlyOptimizeSimulationInput,
} from '@/api/optimization-input'
import { optimizationSettingsInput } from '@/lib/simulation-settings'
import type {
  CreateFarmInput,
  CreateFieldInput,
  CreateSimulationInput,
  EvaluateRotationCandidatesInput,
  Farm,
  FarmView,
  FarmMember,
  FieldRecord,
  FieldRotationCandidates,
  OptimizeSimulationInput,
  SimulationResult,
  RegistryField,
  OptimizationConstraints,
  RecomputeFieldRotationInput,
  RotationCandidateEvaluation,
  Simulation,
  UpdateFieldInput,
  UpdateSimulationInput,
  YearlyOptimizeSimulationInput,
} from '@/api/types'

export const createFarm = (input: CreateFarmInput) =>
  postJson<Farm, CreateFarmInput>('/farms', input)

export const retryFarmHistory = (farmId: string) =>
  postJson<FarmView, Record<string, never>>(
    `/farms/${farmId}/history/retry`,
    {},
  )

export const deleteFarm = (farmId: string) => deleteJson(`/farms/${farmId}`)

export const addFarmMember = (farmId: string, email: string) =>
  postJson<FarmMember, { email: string }>(`/farms/${farmId}/members`, { email })

export const removeFarmMember = (farmId: string, email: string) =>
  deleteJson(`/farms/${farmId}/members/${encodeURIComponent(email)}`)

export const createField = (farmId: string, input: CreateFieldInput) =>
  postJson<FieldRecord, CreateFieldInput>(`/farms/${farmId}/fields`, input)

export const createFields = (farmId: string, input: CreateFieldInput[]) =>
  postJson<FieldRecord[], CreateFieldInput[]>(`/farms/${farmId}/fields`, input)

const registryFieldToInput = (field: RegistryField): CreateFieldInput => ({
  imkId: field.imkId,
  catchmentId: field.catchmentId,
  retention: field.retention,
  name: field.fieldNumber ?? `Mark ${field.imkId}`,
  areaHa: field.areaHa,
  inTakeoutPlan: field.inTakeoutPlan,
  nLoadLimitKgNHa: field.nLoadLimitKgNHa,
  nLoadQuotaKgN: field.nLoadQuotaKgN,
  geometry: field.geometry,
})

export const createFieldsFromRegistry = (
  farmId: string,
  registryFields: RegistryField[],
) => createFields(farmId, registryFields.map(registryFieldToInput))

export const importRegistryFields = async (
  farmId: string,
  imkIds: number[],
): Promise<FieldRecord[]> => {
  const key = registryFieldsBulkKey(imkIds)
  if (!key) return []
  return createFieldsFromRegistry(farmId, await fetcher<RegistryField[]>(key))
}

export const detachField = (farmId: string, fieldId: string) =>
  deleteJson(`/farms/${farmId}/fields/${fieldId}`)

export const createSimulation = (
  farmId: string,
  input: CreateSimulationInput,
) =>
  postJson<Simulation, CreateSimulationInput>(`/farms/${farmId}/simulations`, {
    ...input,
    ...(input.optimizationSettings
      ? {
          optimizationSettings: optimizationSettingsInput(
            input.optimizationSettings,
          ),
        }
      : {}),
  })

export const deleteSimulation = (farmId: string, simulationId: string) =>
  deleteJson(`/farms/${farmId}/simulations/${simulationId}`).then(() => {
    window.dispatchEvent(
      new CustomEvent('simulation:deleted', {
        detail: { farmId, simulationId },
      }),
    )
  })

export const updateSimulation = (
  farmId: string,
  simulationId: string,
  input: UpdateSimulationInput,
) =>
  patchJson<Simulation, UpdateSimulationInput>(
    `/farms/${farmId}/simulations/${simulationId}`,
    {
      ...input,
      ...(input.optimizationSettings
        ? {
            optimizationSettings: optimizationSettingsInput(
              input.optimizationSettings,
            ),
          }
        : {}),
    },
  )

export const retrySimulationCreation = (
  farmId: string,
  simulationId: string,
  optimizeOnCreate = false,
) =>
  postJson<Simulation, { optimizeOnCreate: boolean }>(
    `/farms/${farmId}/simulations/${simulationId}/creation/retry`,
    { optimizeOnCreate },
  )

export const updateSimulationConstraints = (
  farmId: string,
  simulationId: string,
  input: OptimizationConstraints,
) =>
  patchJson<Simulation, OptimizationConstraints>(
    `/farms/${farmId}/simulations/${simulationId}/constraints`,
    input,
  ).then((value) => {
    window.dispatchEvent(
      new CustomEvent('simulation:changed', {
        detail: { farmId, simulationId },
      }),
    )
    return value
  })

export const updateSimulationField = (
  farmId: string,
  simulationId: string,
  fieldId: string,
  input: UpdateFieldInput,
) =>
  patchJson<FieldRecord, UpdateFieldInput>(
    `/farms/${farmId}/simulations/${simulationId}/fields/${fieldId}`,
    input,
  ).then((value) => {
    window.dispatchEvent(
      new CustomEvent('simulation:changed', {
        detail: { farmId, simulationId },
      }),
    )
    return value
  })

export const runSimulationOptimization = (
  farmId: string,
  simulationId: string,
  input: OptimizeSimulationInput = {},
) =>
  postJson<SimulationResult, OptimizeSimulationInput>(
    `/farms/${farmId}/simulations/${simulationId}/optimize`,
    optimizeSimulationInput(input),
  )

export const runYearlySimulationOptimization = (
  farmId: string,
  simulationId: string,
  input: YearlyOptimizeSimulationInput = {},
) =>
  postJson<SimulationResult, YearlyOptimizeSimulationInput>(
    `/farms/${farmId}/simulations/${simulationId}/optimize-yearly`,
    yearlyOptimizeSimulationInput(input),
  )

export const evaluateRotationCandidates = (
  farmId: string,
  input: EvaluateRotationCandidatesInput,
) =>
  postJson<FieldRotationCandidates[], EvaluateRotationCandidatesInput>(
    `/farms/${farmId}/rotation-candidates/evaluate`,
    input,
  )

export const previewFieldRotation = (
  farmId: string,
  simulationId: string,
  fieldId: string,
  input: RecomputeFieldRotationInput,
) =>
  postJson<RotationCandidateEvaluation, RecomputeFieldRotationInput>(
    `/farms/${farmId}/simulations/${simulationId}/fields/${fieldId}/preview-rotation`,
    input,
  )

export const applyFieldRotation = (
  farmId: string,
  simulationId: string,
  fieldId: string,
  input: RecomputeFieldRotationInput,
) =>
  postJson<FieldRecord, RecomputeFieldRotationInput>(
    `/farms/${farmId}/simulations/${simulationId}/fields/${fieldId}/apply-rotation`,
    input,
  ).then((value) => {
    window.dispatchEvent(
      new CustomEvent('simulation:changed', {
        detail: { farmId, simulationId },
      }),
    )
    return value
  })
