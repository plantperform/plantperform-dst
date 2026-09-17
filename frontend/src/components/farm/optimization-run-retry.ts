import {
  optimizationRunRequest,
  useOptimizationRunActions,
  type OptimizationRun,
} from '@/api/optimization-runs'
import type { FieldRecord } from '@/api/types'

// Starts a failed run again with the same settings, and dismisses it.
export const useOptimizationRunRetry = (
  run: OptimizationRun | undefined,
  fields: FieldRecord[] | undefined,
) => {
  const { startRun, dismissRun } = useOptimizationRunActions()
  return {
    retry:
      run && fields
        ? () =>
            startRun({
              ...optimizationRunRequest(run),
              farmId: run.farmId,
              simulationId: run.simulationId,
              fieldsBefore: fields,
            })
        : undefined,
    dismiss: run ? () => dismissRun(run.simulationId) : undefined,
  }
}
