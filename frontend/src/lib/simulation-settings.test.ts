import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  optimizationSettingsError,
} from '@/lib/simulation-settings'
import { fromWire, toWire } from '@/api/wire'
import type { OptimizationSettings } from '@/api/types'

describe('saved optimization settings', () => {
  it('round trips yearly limits and exclusions through the API names', () => {
    const settings: OptimizationSettings = {
      ...DEFAULT_OPTIMIZATION_SETTINGS,
      kind: 'yearly',
      excludedCropCodes: [1, 11],
      db2SwingPct: 20,
      maxNLoadByCatchment: [
        { catchmentId: 4, maxNLoadByYear: { 2027: 150, 2028: 120 } },
      ],
    }
    expect(fromWire(toWire(settings))).toEqual(settings)
    expect(optimizationSettingsError(settings)).toBeNull()
  })
  it('rejects incomplete time limits and invalid yearly bounds before saving', () => {
    for (const timeLimitSeconds of [NaN, 0, -1, 601])
      expect(
        optimizationSettingsError({
          ...DEFAULT_OPTIMIZATION_SETTINGS,
          timeLimitSeconds,
        }),
      ).not.toBeNull()
    expect(
      optimizationSettingsError({
        ...DEFAULT_OPTIMIZATION_SETTINGS,
        maxNLoadByCatchment: [
          { catchmentId: null, maxNLoadByYear: { 2027: -1 } },
        ],
      }),
    ).not.toBeNull()
  })
})
