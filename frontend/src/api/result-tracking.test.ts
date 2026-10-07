import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OptimizationRun } from '@/api/optimization-runs'
import {
  canPollResults,
  ResultRequests,
  shouldAcceptResult,
  watchResultPolling,
} from '@/api/result-tracking'
import type { SimulationResult } from '@/api/types'

const running = {
  id: 'new',
  status: 'running',
  phase: 'in_progress',
} as OptimizationRun
const result = (status: SimulationResult['status'], runId = 'new') =>
  ({ status, runId }) as SimulationResult

describe('persisted result tracking', () => {
  it('restores active state after reload and accepts completion', () => {
    expect(shouldAcceptResult(undefined, result('in_progress'))).toBe(true)
    expect(shouldAcceptResult(running, result('completed'), 'new')).toBe(true)
  })

  it('ignores responses from superseded runs', () => {
    expect(shouldAcceptResult(running, result('completed', 'old'), 'new')).toBe(
      false,
    )
    expect(shouldAcceptResult(running, result('completed', 'old'), 'old')).toBe(
      false,
    )
  })

  it('never resurrects an outdated or finished execution', () => {
    expect(
      shouldAcceptResult(
        { ...running, status: 'outdated' },
        result('completed'),
      ),
    ).toBe(false)
    expect(
      shouldAcceptResult({ ...running, status: 'outdated' }, result('queued')),
    ).toBe(false)
    const succeeded = { ...running, status: 'succeeded' } as OptimizationRun
    expect(shouldAcceptResult(succeeded, result('queued'))).toBe(false)
    expect(shouldAcceptResult(succeeded, result('outdated'))).toBe(true)
  })

  it('invalidates pending polls immediately on edits and replacement submissions', () => {
    const requests = new ResultRequests()
    const first = requests.begin('sim')!
    expect(requests.begin('sim')).toBeUndefined()
    requests.invalidate('sim')
    const second = requests.begin('sim')!
    expect(requests.current('sim', first)).toBe(false)
    requests.finish('sim', first)
    expect(requests.begin('sim')).toBeUndefined()
    expect(requests.current('sim', second)).toBe(true)
    requests.finish('sim', second)
    expect(requests.begin('sim')).toBeDefined()
  })

  it('uses the newest forced refresh and isolates simulations', () => {
    const requests = new ResultRequests()
    const old = requests.begin('sim')!
    const other = requests.begin('other')!
    const latest = requests.begin('sim', true)!
    expect(requests.current('sim', old)).toBe(false)
    expect(requests.current('sim', latest)).toBe(true)
    expect(requests.current('other', other)).toBe(true)
  })

  it('pauses while hidden or offline and resumes when visible online', () => {
    expect(canPollResults(true, true)).toBe(false)
    expect(canPollResults(false, false)).toBe(false)
    expect(canPollResults(false, true)).toBe(true)
  })
})

describe('result polling schedule', () => {
  afterEach(() => vi.useRealTimers())

  it('polls every five seconds, pauses, refreshes on focus, and cleans up', () => {
    vi.useFakeTimers()
    const view = new EventTarget()
    const page = Object.assign(new EventTarget(), { hidden: false })
    const connection = { onLine: true }
    const poll = vi.fn()
    const stop = watchResultPolling(poll, {
      window: Object.assign(view, {
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
      }) as unknown as Window,
      document: page as unknown as Document,
      navigator: connection,
    })
    vi.advanceTimersByTime(4999)
    expect(poll).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(poll.mock.calls).toEqual([[false]])
    vi.advanceTimersByTime(10000)
    expect(poll.mock.calls).toEqual([[false], [false], [false]])
    page.hidden = true
    vi.advanceTimersByTime(10000)
    expect(poll).toHaveBeenCalledTimes(3)
    page.hidden = false
    connection.onLine = false
    view.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(5000)
    expect(poll).toHaveBeenCalledTimes(3)
    connection.onLine = true
    view.dispatchEvent(new Event('online'))
    page.dispatchEvent(new Event('visibilitychange'))
    view.dispatchEvent(new Event('focus'))
    expect(poll.mock.calls.slice(3)).toEqual([[true], [true], [true]])
    stop()
    vi.advanceTimersByTime(10000)
    view.dispatchEvent(new Event('focus'))
    expect(poll).toHaveBeenCalledTimes(6)
  })
})
