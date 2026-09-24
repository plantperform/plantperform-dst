import { createContext, useCallback, useContext } from 'react'

import type {
  FieldRecord,
  OptimizeSimulationInput,
  OptimizeSimulationResponse,
  YearlyOptimizeSimulationInput,
} from '@/api/types'
import type {
  OptimizationChanges,
  OptimizationKind,
} from '@/lib/optimization-run'

export type OptimizationRunRequest =
  | { kind: 'optimize'; input: OptimizeSimulationInput }
  | { kind: 'yearly'; input: YearlyOptimizeSimulationInput }

type OptimizationRunBase = OptimizationRunRequest & {
  id: number
  farmId: string
  simulationId: string
  startedAt: number
  timeLimitSeconds: number
}

export type OptimizationRun = OptimizationRunBase &
  (
    | { status: 'running' }
    | { status: 'failed'; error: string }
    | {
        status: 'succeeded'
        finishedAt: number
        response: OptimizeSimulationResponse
        changes: OptimizationChanges
        refreshing: boolean
      }
  )

export type StartOptimizationRun = (
  request: OptimizationRunRequest & {
    farmId: string
    simulationId: string
    // The simulation's fields before the run, to describe what changed.
    fieldsBefore: FieldRecord[]
  },
) => number | null

export type OptimizationRunsContextValue = {
  runs: ReadonlyMap<string, OptimizationRun>
  staleSince: ReadonlyMap<string, number>
  // Returns the run id, or null when the simulation already has a run going.
  startRun: StartOptimizationRun
  dismissRun: (simulationId: string) => void
  markStale: (simulationId: string) => void
}

export const OptimizationRunsContext =
  createContext<OptimizationRunsContextValue | null>(null)

const useOptimizationRunsContext = () => {
  const context = useContext(OptimizationRunsContext)
  if (!context) {
    throw new Error(
      'Optimization runs must be used inside OptimizationRunsProvider',
    )
  }
  return context
}

// The latest run of the simulation, whichever kind it was.
export const useOptimizationRun = (simulationId?: string) => {
  const { runs } = useOptimizationRunsContext()
  return simulationId ? runs.get(simulationId) : undefined
}

export const useOptimizationStale = (simulationId?: string) => {
  const { staleSince } = useOptimizationRunsContext()
  return simulationId !== undefined && staleSince.has(simulationId)
}

export const useOptimizationRunActions = () => {
  const { startRun, dismissRun, markStale } = useOptimizationRunsContext()
  return { startRun, dismissRun, markStale }
}

export const DEFAULT_TIME_LIMIT_SECONDS: Record<OptimizationKind, number> = {
  optimize: 15,
  yearly: 20,
}

const DEFAULT_OPTIMIZATION_REQUEST: OptimizationRunRequest = {
  kind: 'optimize',
  input: { timeLimitSeconds: DEFAULT_TIME_LIMIT_SECONDS.optimize },
}

export const useStartDefaultOptimization = () => {
  const { startRun } = useOptimizationRunActions()
  return useCallback(
    (farmId: string, simulationId: string, fieldsBefore: FieldRecord[]) =>
      startRun({
        ...DEFAULT_OPTIMIZATION_REQUEST,
        farmId,
        simulationId,
        fieldsBefore,
      }),
    [startRun],
  )
}

// The request that started a run, to start it again after a failure.
export const optimizationRunRequest = (
  run: OptimizationRun,
): OptimizationRunRequest =>
  run.kind === 'optimize'
    ? { kind: 'optimize', input: run.input }
    : { kind: 'yearly', input: run.input }
