import type { OptimizationConstraints, OptimizationSettings } from '@/api/types'
import { cropAreaLimitError } from '@/lib/crop-area-limits'

export const DEFAULT_OPTIMIZATION_SETTINGS: OptimizationSettings = {
  kind: 'optimize',
  excludedCropCodes: [],
  maxNLoadByCatchment: [],
  db2SwingPct: null,
}

export const DEFAULT_SIMULATION_CONSTRAINTS: OptimizationConstraints = {
  maxNLoadByCatchment: [],
  minFeedUnits: null,
  maxFeedUnits: null,
  maxFieldsWithNewRotation: null,
  cropPercentages: [],
  cropAreaLimits: [],
  globallyAllowedRotationIds: null,
}

export function optimizationSettingsError(
  settings: OptimizationSettings,
): string | null {
  const limits = [
    settings.db2SwingPct,
    ...settings.maxNLoadByCatchment.flatMap((cap) =>
      Object.values(cap.maxNLoadByYear),
    ),
  ]
  if (
    limits.some(
      (value) => value !== null && (!Number.isFinite(value) || value < 0),
    )
  )
    return 'Grænserne skal være tal på mindst 0.'
  return null
}

// Select supported settings explicitly: old API responses may contain obsolete
// duration fields even when the TypeScript type no longer declares them.
export const optimizationSettingsInput = (
  settings: OptimizationSettings,
): OptimizationSettings => ({
  kind: settings.kind,
  excludedCropCodes: settings.excludedCropCodes,
  maxNLoadByCatchment: settings.maxNLoadByCatchment,
  db2SwingPct: settings.db2SwingPct,
})

export function simulationLimitsError(
  settings: OptimizationSettings,
  constraints: OptimizationConstraints,
): string | null {
  const settingsError = optimizationSettingsError(settings)
  if (settingsError) return settingsError
  const limits = [
    constraints.minFeedUnits,
    constraints.maxFeedUnits,
    ...constraints.maxNLoadByCatchment.map((cap) => cap.maxNLoadKg),
  ]
  if (
    limits.some(
      (value) => value !== null && (!Number.isFinite(value) || value < 0),
    )
  )
    return 'Grænserne skal være tal på mindst 0.'
  if (
    constraints.minFeedUnits !== null &&
    constraints.maxFeedUnits !== null &&
    constraints.minFeedUnits > constraints.maxFeedUnits
  )
    return 'Min. foderenheder er større end maks.'
  for (const limit of constraints.cropAreaLimits) {
    const error = cropAreaLimitError({
      cropCode: limit.cropCode,
      minHa: limit.minAreaHa === null ? '' : String(limit.minAreaHa),
      maxHa: limit.maxAreaHa === null ? '' : String(limit.maxAreaHa),
    })
    if (error) return `Arealgrænse for afgrøde ${limit.cropCode}: ${error}`
  }
  return null
}
