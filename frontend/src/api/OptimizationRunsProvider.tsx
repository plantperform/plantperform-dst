import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { mutate } from 'swr'

import { ApiError, fetcher } from '@/api/client'
import {
  isSimulationsFieldsKey,
  isSimulationResultsKey,
  simulationFieldsKey,
  simulationYearlySummaryKey,
  simulationsKey,
} from '@/api/hooks'
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
import {
  canPollResults,
  ResultRequests,
  shouldAcceptResult,
  watchResultPolling,
} from '@/api/result-tracking'
import type {
  Simulation,
  SimulationResult,
  YearlySummaryEntry,
} from '@/api/types'
import { cropAreaViolationsFromDetail } from '@/lib/crop-area-limits'
import {
  optimizationFailureMessage,
  summarizeOptimizationChanges,
} from '@/lib/optimization-run'

const resultKey = (farmId: string, simulationId: string) =>
  `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/result`

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
  const runsRef = useRef(runs)
  const acknowledged = useRef(new Set<string>())
  const requests = useRef(new ResultRequests())
  const simulationsRef = useRef(new Map<string, Simulation>())

  const putRun = useCallback((run: OptimizationRun) => {
    const next = new Map(runsRef.current)
    next.set(run.simulationId, run)
    runsRef.current = next
    setRuns(next)
  }, [])

  const markStale = useCallback((simulationId: string) => {
    setStaleSince((old) =>
      old.has(simulationId) ? old : new Map(old).set(simulationId, Date.now()),
    )
  }, [])

  const acceptResult = useCallback(
    async (
      farmId: string,
      simulationId: string,
      result: SimulationResult,
      expectedId?: string,
    ) => {
      const current = runsRef.current.get(simulationId)
      if (!shouldAcceptResult(current, result, expectedId)) return
      if (result.status === 'outdated') markStale(simulationId)
      if (
        !result.runId ||
        !result.kind ||
        acknowledged.current.has(`${result.runId}:${result.status}`)
      )
        return
      const base = {
        farmId,
        simulationId,
        id: result.runId,
        kind: result.kind,
        input: result.parameters,
        startedAt:
          current?.id === result.runId
            ? current.startedAt
            : Date.parse(
                result.queuedAt ?? result.startedAt ?? new Date().toISOString(),
              ),
      }
      if (result.status === 'queued' || result.status === 'in_progress') {
        putRun({ ...base, status: 'running', phase: result.status })
      } else if (result.status === 'outdated') {
        putRun({ ...base, status: 'outdated' })
      } else if (result.status === 'failed') {
        putRun({
          ...base,
          status: 'failed',
          error: optimizationFailureMessage(
            {
              status: result.error?.code === 'TIMEOUT' ? 503 : undefined,
              message: result.error?.message ?? 'Optimeringen fejlede.',
            },
            result.parameters.timeLimitSeconds ??
              OPTIMIZATION_TIME_LIMIT_SECONDS,
          ),
          cropAreaViolations: cropAreaViolationsFromDetail(
            result.error?.detail,
          ),
        })
      } else if (result.status === 'completed' && result.response) {
        if (current?.id === result.runId && current.status === 'succeeded')
          return
        const response = result.response
        const succeeded: Extract<OptimizationRun, { status: 'succeeded' }> = {
          ...base,
          status: 'succeeded',
          response,
          finishedAt: Date.parse(result.finishedAt ?? new Date().toISOString()),
          changes: summarizeOptimizationChanges(
            result.fieldsBefore.length ? result.fieldsBefore : response.fields,
            response.fields,
          ),
          refreshing: true,
        }
        putRun(succeeded)
        setStaleSince((old) => {
          const next = new Map(old)
          next.delete(simulationId)
          return next
        })
        // Refetch setup projections; snapshots are used only for comparisons.
        const yearlyKey = simulationYearlySummaryKey(farmId, simulationId)
        await Promise.allSettled([
          mutate(simulationFieldsKey(farmId, simulationId)),
          mutate(
            (key) =>
              isSimulationsFieldsKey(key, farmId) ||
              isSimulationResultsKey(key, farmId),
          ),
          mutate(simulationsKey(farmId)),
          yearlyKey
            ? mutate(yearlyKey, fetcher<YearlySummaryEntry[]>(yearlyKey), {
                revalidate: false,
              })
            : Promise.resolve(),
        ])
        if (
          runsRef.current.get(simulationId)?.id === succeeded.id &&
          runsRef.current.get(simulationId)?.status === 'succeeded'
        ) {
          putRun({ ...succeeded, refreshing: false })
        }
      }
    },
    [putRun, markStale],
  )

  const refreshResult = useCallback(
    async (
      farmId: string,
      simulationId: string,
      expectedId?: string,
      force = false,
    ) => {
      const ticket = requests.current.begin(simulationId, force)
      if (ticket === undefined) return
      try {
        let result = await fetcher<SimulationResult>(
          `${resultKey(farmId, simulationId)}?include_output=false`,
        )
        const current = runsRef.current.get(simulationId)
        if (
          result.status === 'completed' &&
          !(current?.id === result.runId && current.status === 'succeeded')
        ) {
          if (!requests.current.current(simulationId, ticket)) return
          result = await fetcher<SimulationResult>(
            resultKey(farmId, simulationId),
          )
        }
        if (requests.current.current(simulationId, ticket))
          await acceptResult(farmId, simulationId, result, expectedId)
      } catch {
        // Poll failures leave persisted execution state intact and are retried.
      } finally {
        requests.current.finish(simulationId, ticket)
      }
    },
    [acceptResult],
  )

  const startRun = useCallback<StartOptimizationRun>(
    (request) => {
      if (runsRef.current.get(request.simulationId)?.status === 'running')
        return null
      const id = crypto.randomUUID()
      requests.current.invalidate(request.simulationId)
      const version = requests.current.version(request.simulationId)
      const running: OptimizationRun = {
        ...request,
        id,
        status: 'running',
        phase: 'submitting',
        startedAt: Date.now(),
      }
      putRun(running)
      void (async () => {
        try {
          // Use the revision the user has seen. The backend rejects concurrent edits.
          const simulation =
            simulationsRef.current.get(request.simulationId) ??
            (await fetcher<Simulation>(
              `/farms/${request.farmId}/simulations/${request.simulationId}`,
            ))
          const input = {
            ...request.input,
            runId: id,
            expectedRevision: simulation.revision,
            timeLimitSeconds: OPTIMIZATION_TIME_LIMIT_SECONDS,
          }
          const result =
            request.kind === 'optimize'
              ? await runSimulationOptimization(
                  request.farmId,
                  request.simulationId,
                  input,
                )
              : await runYearlySimulationOptimization(
                  request.farmId,
                  request.simulationId,
                  input,
                )
          if (requests.current.version(request.simulationId) === version)
            await acceptResult(request.farmId, request.simulationId, result, id)
        } catch (error) {
          if (
            runsRef.current.get(request.simulationId)?.id !== id ||
            requests.current.version(request.simulationId) !== version
          )
            return
          // Resolve an ambiguous POST, or restore the active run of another member.
          try {
            const result = await fetcher<SimulationResult>(
              resultKey(request.farmId, request.simulationId),
            )
            if (requests.current.version(request.simulationId) !== version)
              return
            if (
              result.runId &&
              (result.status === 'queued' ||
                result.status === 'in_progress' ||
                result.runId === id)
            ) {
              await acceptResult(request.farmId, request.simulationId, result)
              return
            }
          } catch {
            /* Keep the submission error visible. */
          }
          if (requests.current.version(request.simulationId) !== version) return
          putRun({
            ...running,
            status: 'failed',
            error:
              error instanceof Error
                ? error.message
                : 'Kunne ikke starte optimeringen.',
            cropAreaViolations:
              error instanceof ApiError
                ? cropAreaViolationsFromDetail(error.detail)
                : [],
          })
          void mutate(simulationsKey(request.farmId))
        }
      })()
      return id
    },
    [putRun, acceptResult],
  )

  const syncSimulations = useCallback(
    (simulations: Simulation[]) => {
      for (const simulation of simulations) {
        const summary = simulation.result
        const current = runsRef.current.get(simulation.id)
        if (
          summary.status === 'completed' &&
          !current &&
          !simulationsRef.current.has(simulation.id)
        )
          acknowledged.current.add(`${summary.runId}:completed`)
        simulationsRef.current.set(simulation.id, simulation)
        if (summary.status === 'outdated') markStale(simulation.id)
        if (
          !summary.runId ||
          acknowledged.current.has(`${summary.runId}:${summary.status}`) ||
          (current?.status === 'running' && current.phase === 'submitting')
        )
          continue
        const status =
          current?.status === 'succeeded'
            ? 'completed'
            : current?.status === 'running'
              ? current.phase
              : current?.status
        if (current?.id !== summary.runId || status !== summary.status) {
          void refreshResult(simulation.farmId, simulation.id)
        }
      }
    },
    [refreshResult, markStale],
  )

  useEffect(() => {
    const trackedSimulations = simulationsRef.current
    const trackedRequests = requests.current
    const poll = (all = false) => {
      if (!canPollResults(document.hidden, navigator.onLine)) return
      for (const run of runsRef.current.values()) {
        if (run.status === 'running' && run.phase === 'submitting') continue
        if (all || run.status === 'running')
          void refreshResult(
            run.farmId,
            run.simulationId,
            all ? undefined : run.id,
          )
      }
    }
    const changed = (event: Event) => {
      const { farmId, simulationId } = (
        event as CustomEvent<{ farmId: string; simulationId: string }>
      ).detail
      requests.current.invalidate(simulationId)
      simulationsRef.current.delete(simulationId)
      markStale(simulationId)
      const current = runsRef.current.get(simulationId)
      if (current) putRun({ ...current, status: 'outdated' })
      void mutate(simulationsKey(farmId))
      void refreshResult(farmId, simulationId, undefined, true)
    }
    const deleted = (event: Event) => {
      const { simulationId } = (event as CustomEvent<{ simulationId: string }>)
        .detail
      requests.current.invalidate(simulationId)
      simulationsRef.current.delete(simulationId)
      const next = new Map(runsRef.current)
      next.delete(simulationId)
      runsRef.current = next
      setRuns(next)
      setStaleSince((old) => {
        const next = new Map(old)
        next.delete(simulationId)
        return next
      })
    }
    const stopPolling = watchResultPolling(poll, {
      window,
      document,
      navigator,
    })
    window.addEventListener('simulation:changed', changed)
    window.addEventListener('simulation:deleted', deleted)
    return () => {
      stopPolling()
      for (const simulation of trackedSimulations.values())
        trackedRequests.invalidate(simulation.id)
      window.removeEventListener('simulation:changed', changed)
      window.removeEventListener('simulation:deleted', deleted)
    }
  }, [refreshResult, markStale, putRun])

  const dismissRun = useCallback((simulationId: string) => {
    const current = runsRef.current.get(simulationId)
    if (current?.status === 'running') return
    if (current)
      acknowledged.current.add(
        `${current.id}:${current.status === 'succeeded' ? 'completed' : current.status}`,
      )
    requests.current.invalidate(simulationId)
    const next = new Map(runsRef.current)
    next.delete(simulationId)
    runsRef.current = next
    setRuns(next)
  }, [])
  const value = useMemo(
    () => ({
      runs,
      staleSince,
      startRun,
      dismissRun,
      markStale,
      syncSimulations,
    }),
    [runs, staleSince, startRun, dismissRun, markStale, syncSimulations],
  )
  return (
    <OptimizationRunsContext.Provider value={value}>
      {children}
    </OptimizationRunsContext.Provider>
  )
}
