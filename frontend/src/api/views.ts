import { useEffect, useMemo } from 'react'
import useSWR, { mutate, useSWRConfig, type Cache } from 'swr'

import { fetcher } from '@/api/client'
import { useFieldAliases } from '@/api/field-aliases'
import { JOB_POLL_INTERVAL_MS, watchResultPolling } from '@/api/result-tracking'
import type { FarmView, SimulationView, ViewState } from '@/api/types'
import { isViewPreparing, mergeViewStatus } from '@/api/view-cache'
import {
  applyFarmViewAliases,
  applySimulationViewAliases,
  EMPTY_FIELD_ALIASES,
} from '@/lib/field-aliases'

export const farmViewKey = (farmId?: string) =>
  farmId ? `/farms/${encodeURIComponent(farmId)}/view` : null

export const simulationViewKey = (farmId?: string, simulationId?: string) =>
  farmId && simulationId
    ? `/farms/${encodeURIComponent(farmId)}/simulations/${encodeURIComponent(simulationId)}/view`
    : null

type View = ViewState & { data: unknown }
const pending = new Map<string, Promise<unknown>>()

export const loadView = <T extends View>(key: string): Promise<T> => {
  const existing = pending.get(key)
  if (existing) return existing as Promise<T>
  const request = fetcher<T>(key).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

const pollers = new WeakMap<
  Cache,
  Map<string, { count: number; stop: () => void; open: () => void }>
>()

export const subscribeView = <T extends View>(
  cache: Cache,
  key: string,
  update: (value: T) => Promise<unknown> | void,
  environment: Parameters<typeof watchResultPolling>[1],
) => {
  let entries = pollers.get(cache)
  if (!entries) {
    entries = new Map()
    pollers.set(cache, entries)
  }
  let entry = entries.get(key)
  if (!entry) {
    let reading = false
    const active = () => entries.get(key) === entry
    const refresh = async (all: boolean, retryFailed = false) => {
      const current = cache.get(key)?.data as T | undefined
      if (!current || reading || (!all && !isViewPreparing(current))) return
      reading = true
      try {
        const reopening = retryFailed && current.status === 'failed'
        const status = reopening
          ? await loadView<T>(key)
          : await fetcher<T>(`${key}?include_data=false`)
        const latest = cache.get(key)?.data as T | undefined
        if (!latest || !active()) return
        const next = await mergeViewStatus(latest, status, () =>
          reopening ? Promise.resolve(status) : loadView<T>(key),
        )
        if (active()) await update(next)
      } catch {
        // Persisted job state remains authoritative; a later poll retries.
      } finally {
        reading = false
      }
    }
    entry = {
      count: 0,
      stop: watchResultPolling((all = false) => void refresh(all), environment),
      open: () => {
        if (cache.get(key)?.data?.status === 'failed') void refresh(true, true)
      },
    }
    entries.set(key, entry)
  }
  entry.count += 1
  entry.open()
  return () => {
    if (--entry.count === 0) {
      entry.stop()
      entries.delete(key)
    }
  }
}

const useView = <T extends View>(key: string | null) => {
  const response = useSWR<T>(key, loadView<T>, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  })
  const { cache, mutate: update } = useSWRConfig()
  useEffect(() => {
    if (!key) return
    return subscribeView<T>(
      cache,
      key,
      (value) => update(key, value, { revalidate: false }),
      { window, document, navigator },
    )
  }, [cache, key, update])
  return response
}

// Keep persisted view caches canonical; personal labels are reactive projections.
export const useFarmView = (farmId?: string) => {
  const response = useView<FarmView>(farmViewKey(farmId))
  const { data: aliases = EMPTY_FIELD_ALIASES } = useFieldAliases()
  const data = useMemo(
    () => applyFarmViewAliases(response.data, aliases),
    [response.data, aliases],
  )
  return { ...response, data }
}

export const useSimulationView = (farmId?: string, simulationId?: string) => {
  const response = useView<SimulationView>(simulationViewKey(farmId, simulationId))
  const { data: aliases = EMPTY_FIELD_ALIASES } = useFieldAliases()
  const data = useMemo(
    () => applySimulationViewAliases(response.data, aliases),
    [response.data, aliases],
  )
  return { ...response, data }
}

export const fetchFarmView = async (farmId: string) => {
  const key = farmViewKey(farmId)!
  const view = await loadView<FarmView>(key)
  await mutate(key, view, { revalidate: false })
  return view
}

export const fetchSimulationView = async (
  farmId: string,
  simulationId: string,
) => {
  const key = simulationViewKey(farmId, simulationId)!
  const view = await loadView<SimulationView>(key)
  await mutate(key, view, { revalidate: false })
  return view
}

export const waitForFarmHistory = async (
  farmId: string,
  signal: AbortSignal,
) => {
  const key = farmViewKey(farmId)!
  while (!signal.aborted) {
    if (!document.hidden && navigator.onLine) {
      const view = await fetcher<FarmView>(`${key}?include_data=false`, signal)
      if (view.status === 'done') return fetchFarmView(farmId)
      if (view.status === 'failed')
        throw new Error('Markernes historik kunne ikke beregnes.')
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        window.clearTimeout(timer)
        reject(new DOMException('Stopped preparing history', 'AbortError'))
      }
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, JOB_POLL_INTERVAL_MS)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  throw new DOMException('Stopped preparing history', 'AbortError')
}
