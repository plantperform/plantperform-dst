import type {
  OptimizeSimulationInput,
  YearlyOptimizeSimulationInput,
} from '@/api/types'

// Run results from older backends can contain additional parameters. Never
// spread those parameters into a new request, including when retrying a run.
export const optimizeSimulationInput = (
  input: OptimizeSimulationInput,
): OptimizeSimulationInput => ({
  expectedRevision: input.expectedRevision,
  runId: input.runId,
  excludedCropCodes: input.excludedCropCodes,
})

export const yearlyOptimizeSimulationInput = (
  input: YearlyOptimizeSimulationInput,
): YearlyOptimizeSimulationInput => ({
  ...optimizeSimulationInput(input),
  maxNLoadByCatchment: input.maxNLoadByCatchment,
  db2SwingPct: input.db2SwingPct,
  quotaTrades: input.quotaTrades,
})
