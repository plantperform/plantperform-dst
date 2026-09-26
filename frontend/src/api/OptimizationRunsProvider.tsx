import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { mutate } from 'swr'

import { ApiError, fetcher } from '@/api/client'
import { simulationFieldsKey, simulationYearlySummaryKey } from '@/api/hooks'
import {
  runSimulationOptimization,
  runYearlySimulationOptimization,
} from '@/api/mutations'
import {
  OPTIMIZATION_TIME_LIMIT_SECONDS,
  OptimizationRunsContext,
  type OptimizationRun,
  type StartOptimizationRun,
} from '@/api/optimization-runs'
import type { YearlySummaryEntry } from '@/api/types'
import {
  optimizationFailureMessage,
  summarizeOptimizationChanges,
} from '@/lib/optimization-run'

// After a run, simulationFieldsKey is updated directly from the response. The
// yearly overview strip uses a separate SWR key that takes a while to
// recompute, so the run is marked succeeded as soon as the fields are in and
// stays "refreshing" until the strip has caught up; the strip shows that
// instead of the numbers from before the run.
//
// Candidate detail is deliberately not invalidated: a broad key match used to
// refetch every detail panel ever opened in the simulation, causing a burst of
// failed requests (422 "ikke optimeret endnu") for unoptimised fields. SWR
// reloads it when the panel next mounts.
const refreshYearlySummary = async (farmId: string, simulationId: string) => {
  const key = simulationYearlySummaryKey(farmId, simulationId)
  if (!key) return
  await mutate(key, fetcher<YearlySummaryEntry[]>(key), {
    revalidate: false,
  }).catch(() => undefined)
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
  const [staleSince, setStaleSince] = useState<ReadonlyMap<string, number>>(
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
      }
      putRun(running)

      const run = async () => {
        try {
          const response =
            request.kind === 'optimize'
              ? await runSimulationOptimization(farmId, simulationId, {
                  ...request.input,
                  timeLimitSeconds: OPTIMIZATION_TIME_LIMIT_SECONDS,
                })
              : await runYearlySimulationOptimization(farmId, simulationId, {
                  ...request.input,
                  timeLimitSeconds: OPTIMIZATION_TIME_LIMIT_SECONDS,
                })
          await mutate(simulationFieldsKey(farmId, simulationId), response.fields, {
            revalidate: false,
          })
          void mutate(simulationFieldsKey(farmId, simulationId))
          const succeeded: OptimizationRun = {
            ...running,
            status: 'succeeded',
            finishedAt: Date.now(),
            response,
            changes: summarizeOptimizationChanges(fieldsBefore, response.fields),
            refreshing: true,
          }
          putRun(succeeded)
          setStaleSince((current) => {
            const markedAt = current.get(simulationId)
            if (markedAt === undefined || markedAt > running.startedAt) {
              return current
            }
            const next = new Map(current)
            next.delete(simulationId)
            return next
          })
          await refreshYearlySummary(farmId, simulationId)
          if (runsRef.current.get(simulationId)?.id === succeeded.id) {
            putRun({ ...succeeded, refreshing: false })
          }
        } catch (error) {
          putRun({
            ...running,
            status: 'failed',
            error: optimizationFailureMessage(
              {
                status: error instanceof ApiError ? error.status : undefined,
                message:
                  error instanceof Error
                    ? error.message
                    : 'Kunne ikke køre optimeringen.',
              },
              OPTIMIZATION_TIME_LIMIT_SECONDS,
            ),
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

  const markStale = useCallback((simulationId: string) => {
    setStaleSince((current) => new Map(current).set(simulationId, Date.now()))
  }, [])

  const value = useMemo(
    () => ({ runs, staleSince, startRun, dismissRun, markStale }),
    [runs, staleSince, startRun, dismissRun, markStale],
  )

  return (
    <OptimizationRunsContext.Provider value={value}>
      {children}
    </OptimizationRunsContext.Provider>
  )
}
