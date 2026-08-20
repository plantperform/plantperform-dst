import { deleteJson, patchJson, postJson } from '@/api/client'
import type {
  CreateFarmInput,
  CreateFieldInput,
  CreateSimulationInput,
  EvaluateRotationCandidatesInput,
  Farm,
  FieldRecord,
  FieldRotationCandidates,
  OptimizeSimulationInput,
  OptimizeSimulationResponse,
  OptimizationConstraints,
  RecomputeFieldRotationInput,
  RotationCandidateEvaluation,
  Simulation,
  UpdateFarmInput,
  UpdateFieldInput,
  YearlyOptimizeSimulationInput,
  YearlyOptimizeSimulationResponse,
} from '@/api/types'

export const createFarm = (input: CreateFarmInput) =>
  postJson<Farm, CreateFarmInput>('/farms', input)

export const deleteFarm = (farmId: string) => deleteJson(`/farms/${farmId}`)

export const updateFarm = (farmId: string, input: UpdateFarmInput) =>
  patchJson<Farm, UpdateFarmInput>(`/farms/${farmId}`, input)

export const createField = (farmId: string, input: CreateFieldInput) =>
  postJson<FieldRecord, CreateFieldInput>(`/farms/${farmId}/fields`, input)

export const createFields = (farmId: string, input: CreateFieldInput[]) =>
  postJson<FieldRecord[], CreateFieldInput[]>(`/farms/${farmId}/fields`, input)

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
