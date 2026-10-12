import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetcher } from '@/api/client'
import { loadView, subscribeView, waitForFarmHistory } from '@/api/views'

vi.mock('@/api/client', () => ({ fetcher: vi.fn() }))

const key = '/farms/farm/simulations/sim/view'
const preparing = {
  inputRevision: 1,
  viewVersion: 1,
  status: 'queued' as const,
  data: null,
  error: null,
}
const ready = {
  ...preparing,
  viewVersion: 2,
  status: 'done' as const,
  data: { fields: ['field'], fieldYears: { field: [1, 2] } },
}

const environment = () => {
  const page = Object.assign(new EventTarget(), { hidden: false })
  const connection = { onLine: true }
  const view = Object.assign(new EventTarget(), {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
  return {
    window: view as unknown as Window,
    document: page as unknown as Document,
    navigator: connection,
    page,
    connection,
  }
}

describe('shared compact view requests', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it('deduplicates simultaneous display reads and never requests field details', async () => {
    vi.mocked(fetcher).mockResolvedValue(ready)
    await Promise.all([loadView(key), loadView(key), loadView(key)])
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(key)
  })

  it('shares one metadata poll, loads one changed snapshot, and pauses hidden/offline', async () => {
    vi.useFakeTimers()
    const env = environment()
    const cache = new Map([[key, { data: preparing }]])
    const update = vi.fn((value) => {
      cache.set(key, { data: value })
    })
    vi.mocked(fetcher)
      .mockResolvedValueOnce({ ...preparing, status: 'running' })
      .mockResolvedValueOnce({ ...ready, data: null })
      .mockResolvedValueOnce(ready)
    const first = subscribeView(cache, key, update, env)
    const second = subscribeView(cache, key, update, env)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${key}?include_data=false`)
    env.page.hidden = true
    await vi.advanceTimersByTimeAsync(10000)
    env.page.hidden = false
    env.connection.onLine = false
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    first()
    env.connection.onLine = true
    await vi.advanceTimersByTimeAsync(2000)
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      `${key}?include_data=false`,
      `${key}?include_data=false`,
      key,
    ])
    expect(cache.get(key)?.data).toEqual(ready)
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetcher).toHaveBeenCalledTimes(3)
    second()
    env.window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('drops pending polls when all consumers leave, including a later new subscription', async () => {
    vi.useFakeTimers()
    const env = environment()
    const cache = new Map([[key, { data: preparing }]])
    const update = vi.fn()
    let resolve!: (value: unknown) => void
    vi.mocked(fetcher).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const stop = subscribeView(cache, key, update, env)
    await vi.advanceTimersByTimeAsync(2000)
    stop()
    const later = subscribeView(cache, key, update, env)
    resolve({ ...ready, data: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(update).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    later()
  })

  it('reloads a cached failed view once on opening and uses metadata on focus', async () => {
    vi.useFakeTimers()
    const env = environment()
    const failed = { ...preparing, status: 'failed' as const }
    const cache = new Map([[key, { data: failed }]])
    const update = vi.fn((value) => {
      cache.set(key, { data: value })
    })
    vi.mocked(fetcher).mockResolvedValue(failed)
    const first = subscribeView(cache, key, update, env)
    const second = subscribeView(cache, key, update, env)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(key)
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    env.window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      key,
      `${key}?include_data=false`,
    ])
    first()
    second()
    const reopen = subscribeView(cache, key, update, env)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      key,
      `${key}?include_data=false`,
      key,
    ])
    reopen()
  })

  it('retries a failed view when another consumer opens it and then polls the new job', async () => {
    vi.useFakeTimers()
    const env = environment()
    const failed = { ...preparing, status: 'failed' as const }
    const cache = new Map([
      [key, { data: preparing as typeof preparing | typeof failed }],
    ])
    const update = vi.fn((value) => {
      cache.set(key, { data: value })
    })
    const existing = subscribeView(cache, key, update, env)
    cache.set(key, { data: failed })
    vi.mocked(fetcher)
      .mockResolvedValueOnce({ ...preparing, viewVersion: 2 })
      .mockResolvedValueOnce({ ...preparing, viewVersion: 3, status: 'running' })
    const opened = subscribeView(cache, key, update, env)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(key)
    await vi.advanceTimersByTimeAsync(2000)
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      key,
      `${key}?include_data=false`,
    ])
    opened()
    existing()
  })

  it('does not overlap metadata requests when a job poll takes longer than two seconds', async () => {
    vi.useFakeTimers()
    const env = environment()
    const cache = new Map([[key, { data: preparing }]])
    let resolve!: (value: unknown) => void
    vi.mocked(fetcher).mockImplementationOnce(
      () => new Promise((done) => { resolve = done }),
    )
    const stop = subscribeView(cache, key, vi.fn(), env)
    await vi.advanceTimersByTimeAsync(6000)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${key}?include_data=false`)
    resolve(preparing)
    await vi.advanceTimersByTimeAsync(0)
    stop()
  })

  it('waits for farm history at two-second intervals and fetches the completed snapshot once', async () => {
    vi.useFakeTimers()
    const env = environment()
    vi.stubGlobal('window', env.window)
    vi.stubGlobal('document', env.document)
    vi.stubGlobal('navigator', env.navigator)
    const farmKey = '/farms/history-wait/view'
    vi.mocked(fetcher)
      .mockResolvedValueOnce(preparing)
      .mockResolvedValueOnce({ ...ready, data: null })
      .mockResolvedValueOnce(ready)
    const result = waitForFarmHistory('history-wait', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `${farmKey}?include_data=false`,
      expect.any(AbortSignal),
    )
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual(ready)
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      `${farmKey}?include_data=false`,
      `${farmKey}?include_data=false`,
      farmKey,
    ])
  })

  it('pauses the history wait while hidden or offline and cancels its timer', async () => {
    vi.useFakeTimers()
    const env = environment()
    vi.stubGlobal('window', env.window)
    vi.stubGlobal('document', env.document)
    vi.stubGlobal('navigator', env.navigator)
    env.page.hidden = true
    const controller = new AbortController()
    const result = waitForFarmHistory('cancelled-wait', controller.signal)
    const rejection = expect(result).rejects.toHaveProperty('name', 'AbortError')
    await vi.advanceTimersByTimeAsync(2000)
    env.page.hidden = false
    env.connection.onLine = false
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetcher).not.toHaveBeenCalled()
    controller.abort()
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
})
