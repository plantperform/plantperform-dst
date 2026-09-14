import { deleteJson, fetcher, patchJson, postJson } from '@/api/client'
import { registryFieldsBulkKey } from '@/api/hooks'
import type {
  CreateFarmInput,
  CreateFieldInput,
  CreateSimulationInput,
  EvaluateRotationCandidatesInput,
  Farm,
  FarmMember,
  FieldRecord,
  FieldRotationCandidates,
  OptimizeSimulationInput,
  OptimizeSimulationResponse,
  RegistryField,
  OptimizationConstraints,
  RecomputeFieldRotationInput,
  RotationCandidateEvaluation,
  Simulation,
  UpdateFieldInput,
  YearlyOptimizeSimulationInput,
  YearlyOptimizeSimulationResponse,
} from '@/api/types'

export const createFarm = (input: CreateFarmInput) =>
  postJson<Farm, CreateFarmInput>('/farms', input)

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
  kystvandId: field.kystvandId,
  retention: field.retention,
  name: field.marknr ?? `Mark ${field.imkId}`,
  areaHa: field.areaHa,
  inTakeoutPlan: field.inTakeoutPlan,
  udledningsgraenseKgnHa: field.udledningsgraenseKgnHa,
  udledningskvoteMarkKgn: field.udledningskvoteMarkKgn,
  geometry: field.geometry,
})

export const importRegistryFields = async (
  farmId: string,
  imkIds: number[],
): Promise<FieldRecord[]> => {
  const key = registryFieldsBulkKey(imkIds)
  if (!key) return []
  const registryFields = await fetcher<RegistryField[]>(key)
  return createFields(farmId, registryFields.map(registryFieldToInput))
}

export const detachField = (farmId: string, fieldId: string) =>
  deleteJson(`/farms/${farmId}/fields/${fieldId}`)

export const createSimulation = (
  farmId: string,
  input: CreateSimulationInput,
) =>
  postJson<Simulation, CreateSimulationInput>(
    `/farms/${farmId}/simulations`,
    input,
  )

export const deleteSimulation = (farmId: string, simulationId: string) =>
  deleteJson(`/farms/${farmId}/simulations/${simulationId}`)

export const updateSimulationConstraints = (
  farmId: string,
  simulationId: string,
  input: OptimizationConstraints,
) =>
  patchJson<Simulation, OptimizationConstraints>(
    `/farms/${farmId}/simulations/${simulationId}/constraints`,
    input,
  )

export const updateSimulationField = (
  farmId: string,
  simulationId: string,
  fieldId: string,
  input: UpdateFieldInput,
) =>
  patchJson<FieldRecord, UpdateFieldInput>(
    `/farms/${farmId}/simulations/${simulationId}/fields/${fieldId}`,
    input,
  )

export const runSimulationOptimization = (
  farmId: string,
  simulationId: string,
  input: OptimizeSimulationInput = {},
) =>
  postJson<OptimizeSimulationResponse, OptimizeSimulationInput>(
    `/farms/${farmId}/simulations/${simulationId}/optimize`,
    input,
  )

export const runYearlySimulationOptimization = (
  farmId: string,
  simulationId: string,
  input: YearlyOptimizeSimulationInput = {},
) =>
  postJson<YearlyOptimizeSimulationResponse, YearlyOptimizeSimulationInput>(
    `/farms/${farmId}/simulations/${simulationId}/optimize-yearly`,
    input,
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
  )
