import { describe, expect, it, vi } from 'vitest'

import { isViewPreparing, mergeViewStatus } from '@/api/view-cache'
import type { ViewState } from '@/api/types'

const ready: ViewState & {
  data: { fields: string[]; fieldYears: Record<string, number[]> } | null
} = {
  inputRevision: 1,
  viewVersion: 4,
  status: 'done' as const,
  error: null,
  data: { fields: ['field'], fieldYears: { field: [1, 2] } },
}

describe('compact view refresh', () => {
  it('keeps display data when metadata reports the same version', async () => {
    const load = vi.fn()
    const next = await mergeViewStatus(ready, { ...ready, data: null }, load)
    expect(next.data).toEqual(ready.data)
    expect(load).not.toHaveBeenCalled()
  })

  it('loads one snapshot when a completed job publishes a new version', async () => {
    const snapshot = {
      ...ready,
      viewVersion: 5,
      data: { fields: ['new'], fieldYears: {} },
    }
    const load = vi.fn().mockResolvedValue(snapshot)
    expect(
      await mergeViewStatus(
        ready,
        { ...ready, viewVersion: 5, data: null },
        load,
      ),
    ).toEqual(snapshot)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not load large snapshots while preparing or after failure', async () => {
    for (const status of ['queued', 'running', 'failed'] as const) {
      const load = vi.fn()
      const next = await mergeViewStatus(
        ready,
        { ...ready, status, data: null },
        load,
      )
      expect(next.data).toBeNull()
      expect(load).not.toHaveBeenCalled()
      expect(isViewPreparing(next)).toBe(status !== 'failed')
    }
  })

  it('ignores an old poll after a newer view or input revision arrived', async () => {
    const load = vi.fn()
    for (const old of [
      { ...ready, viewVersion: 3 },
      { ...ready, inputRevision: 0 },
    ]) {
      expect(await mergeViewStatus(ready, { ...old, data: null }, load)).toBe(
        ready,
      )
    }
    expect(load).not.toHaveBeenCalled()
  })
})
