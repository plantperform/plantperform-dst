import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  readStoredColumnVisibility,
  withoutAutumnAllocationColumn,
} from '@/components/farm/field-list-state'

const storeColumns = (columns: Record<string, boolean>) =>
  vi.stubGlobal('window', {
    localStorage: { getItem: () => JSON.stringify(columns) },
  })

describe('stored column visibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a Gødning column added later with the rest of the group', () => {
    storeColumns({ mineralFertiliser: true })

    expect(readStoredColumnVisibility(true).autumnAllocated).toBe(true)
  })

  it('keeps a Gødning column added later hidden with the group', () => {
    storeColumns({ mineralFertiliser: false })

    expect(readStoredColumnVisibility(true).autumnAllocated).toBe(false)
  })

  it('keeps a stored choice for the column', () => {
    storeColumns({ mineralFertiliser: true, autumnAllocated: false })

    expect(readStoredColumnVisibility(true).autumnAllocated).toBe(false)
  })
})

describe('withoutAutumnAllocationColumn', () => {
  it('hides only that column', () => {
    expect(
      withoutAutumnAllocationColumn({ autumnAllocated: true, db2: true }),
    ).toEqual({ autumnAllocated: false, db2: true })
  })
})
