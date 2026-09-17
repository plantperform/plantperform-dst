import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { mutate } from 'swr'

import { simulationFieldsKey, simulationYearlySummaryKey } from '@/api/hooks'
import {
  runSimulationOptimization,
  runYearlySimulationOptimization,
} from '@/api/mutations'
import {
  DEFAULT_TIME_LIMIT_SECONDS,
  OptimizationRunsContext,
  type OptimizationRun,
  type StartOptimizationRun,
} from '@/api/optimization-runs'
import { summarizeOptimizationChanges } from '@/lib/optimization-run'

// After a run, simulationFieldsKey is updated directly from the response. The
// yearly overview strip uses a separate SWR key and would otherwise keep data
// from before the run, which makes new constraints or caps look ignored.
//
// Candidate detail is deliberately not invalidated: a broad key match used to
// refetch every detail panel ever opened in the simulation, causing a burst of
// failed requests (422 "ikke optimeret endnu") for unoptimised fields. SWR
// reloads it when the panel next mounts.
const invalidateOptimizationDisplays = async (
  farmId: string,
  simulationId: string,
) => {
  await mutate(simulationYearlySummaryKey(farmId, simulationId))
}

// Owns running optimizations above the routes, so a run keeps its result or
// error when the dialog closes or the user leaves the farm page.
export const OptimizationRunsProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const [runs, setRuns] = useState<ReadonlyMap<string, OptimizationRun>>(
    () => new Map(),
  )
  // Mirrors `runs` synchronously, so two quick clicks cannot start two runs.
  const runsRef = useRef(runs)
  const nextId = useRef(1)

  const putRun = useCallback((run: OptimizationRun) => {
    const next = new Map(runsRef.current)
    next.set(run.simulationId, run)
    runsRef.current = next
    setRuns(next)
  }, [])

  const startRun = useCallback<StartOptimizationRun>(
    ({ fieldsBefore, ...request }) => {
      const { farmId, simulationId } = request
      if (runsRef.current.get(simulationId)?.status === 'running') return null

      const running: OptimizationRun = {
        ...request,
        id: nextId.current++,
        status: 'running',
        startedAt: Date.now(),
        timeLimitSeconds:
          request.input.timeLimitSeconds ??
          DEFAULT_TIME_LIMIT_SECONDS[request.kind],
      }
      putRun(running)

      const run = async () => {
        try {
          const response =
            request.kind === 'optimize'
              ? await runSimulationOptimization(
                  farmId,
                  simulationId,
                  request.input,
                )
              : await runYearlySimulationOptimization(
                  farmId,
                  simulationId,
                  request.input,
                )
          await mutate(simulationFieldsKey(farmId, simulationId), response.fields, {
            revalidate: false,
          })
          await invalidateOptimizationDisplays(farmId, simulationId)
          putRun({
            ...running,
            status: 'succeeded',
            finishedAt: Date.now(),
            response,
            changes: summarizeOptimizationChanges(fieldsBefore, response.fields),
          })
        } catch (error) {
          putRun({
            ...running,
            status: 'failed',
            error:
              error instanceof Error
                ? error.message
                : 'Kunne ikke køre optimeringen.',
          })
        }
      }
      void run()

      return running.id
    },
    [putRun],
  )

  const dismissRun = useCallback((simulationId: string) => {
    if (runsRef.current.get(simulationId)?.status === 'running') return
    const next = new Map(runsRef.current)
    next.delete(simulationId)
    runsRef.current = next
    setRuns(next)
  }, [])

  const value = useMemo(
    () => ({ runs, startRun, dismissRun }),
    [runs, startRun, dismissRun],
  )

  return (
    <OptimizationRunsContext.Provider value={value}>
      {children}
    </OptimizationRunsContext.Provider>
  )
}
