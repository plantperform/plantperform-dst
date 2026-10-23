import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  DEFAULT_SIMULATION_CONSTRAINTS,
  optimizationSettingsError,
  optimizationSettingsInput,
  simulationLimitsError,
} from '@/lib/simulation-settings'
import { fromWire, toWire } from '@/api/wire'
import type { OptimizationSettings } from '@/api/types'
import { syncYearlyNLoadCaps } from '@/components/farm/catchment-options'
import type { FieldRecord } from '@/api/types'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'

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
  it('rejects invalid yearly bounds before saving', () => {
    for (const db2SwingPct of [NaN, Infinity, -1])
      expect(
        optimizationSettingsError({
          ...DEFAULT_OPTIMIZATION_SETTINGS,
          db2SwingPct,
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

  it('drops legacy duration values while preserving supported settings', () => {
    const legacy = {
      ...DEFAULT_OPTIMIZATION_SETTINGS,
      timeLimitSeconds: 1,
      time_limit_seconds: 7200,
    }
    expect(optimizationSettingsInput(legacy)).toEqual(
      DEFAULT_OPTIMIZATION_SETTINGS,
    )
    expect(optimizationSettingsError(legacy)).toBeNull()
  })

  it('checks feed, emissions and crop bounds before advancing from limits', () => {
    for (const minFeedUnits of [NaN, Infinity, -1]) {
      expect(
        simulationLimitsError(DEFAULT_OPTIMIZATION_SETTINGS, {
          ...DEFAULT_SIMULATION_CONSTRAINTS,
          minFeedUnits,
        }),
      ).not.toBeNull()
    }
    expect(
      simulationLimitsError(DEFAULT_OPTIMIZATION_SETTINGS, {
        ...DEFAULT_SIMULATION_CONSTRAINTS,
        minFeedUnits: 2,
        maxFeedUnits: 1,
      }),
    ).toContain('Min. foderenheder')
    expect(
      simulationLimitsError(DEFAULT_OPTIMIZATION_SETTINGS, {
        ...DEFAULT_SIMULATION_CONSTRAINTS,
        maxNLoadByCatchment: [{ catchmentId: 1, maxNLoadKg: -1 }],
      }),
    ).not.toBeNull()
    for (const [minAreaHa, maxAreaHa] of [
      [2, 1],
      [null, null],
      [Infinity, 1],
      [-1, null],
    ]) {
      expect(
        simulationLimitsError(DEFAULT_OPTIMIZATION_SETTINGS, {
          ...DEFAULT_SIMULATION_CONSTRAINTS,
          cropAreaLimits: [{ cropCode: 1, minAreaHa, maxAreaHa }],
        }),
      ).not.toBeNull()
    }
    expect(
      simulationLimitsError(
        DEFAULT_OPTIMIZATION_SETTINGS,
        DEFAULT_SIMULATION_CONSTRAINTS,
      ),
    ).toBeNull()
  })

  it('starts yearly caps from Regler or the kvote and keeps per-year caps', () => {
    const everyYear = (value: number) =>
      Object.fromEntries(ROTATION_CALENDAR_YEARS.map((year) => [year, value]))
    const settings: OptimizationSettings = {
      ...DEFAULT_OPTIMIZATION_SETTINGS,
      kind: 'yearly',
      maxNLoadByCatchment: [
        { catchmentId: 1, maxNLoadByYear: { 2027: 12 } },
        { catchmentId: 2, maxNLoadByYear: everyYear(50) },
      ],
    }
    expect(syncYearlyNLoadCaps(settings, [], [])).toBe(settings)
    const fields = [1, 2, 3, 4].map(
      (catchmentId) =>
        ({
          catchmentId,
          quotaEligible: true,
          nLoadQuotaKgN: 100,
        }) as FieldRecord,
    )
    const synced = syncYearlyNLoadCaps(settings, fields, [
      { catchmentId: 2, maxNLoadKg: 80 },
      { catchmentId: 4, maxNLoadKg: null },
    ])
    expect(synced.maxNLoadByCatchment).toEqual([
      // Different years: kept as saved.
      { catchmentId: 1, maxNLoadByYear: { 2027: 12 } },
      // The same in every year: follows Regler.
      { catchmentId: 2, maxNLoadByYear: everyYear(80) },
      // Nothing under Regler: the kvote.
      { catchmentId: 3, maxNLoadByYear: everyYear(100) },
      // Ingen grænse under Regler.
      { catchmentId: 4, maxNLoadByYear: {} },
    ])
    expect(
      syncYearlyNLoadCaps(synced, fields, [
        { catchmentId: 2, maxNLoadKg: 80 },
        { catchmentId: 4, maxNLoadKg: null },
      ]),
    ).toBe(synced)
  })
})
