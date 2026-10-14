import type { OptimizationConstraints, OptimizationSettings } from '@/api/types'

export const DEFAULT_OPTIMIZATION_SETTINGS: OptimizationSettings = {
  kind: 'optimize',
  timeLimitSeconds: 90,
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
  if (
    !Number.isFinite(settings.timeLimitSeconds) ||
    settings.timeLimitSeconds <= 0 ||
    settings.timeLimitSeconds > 600
  )
    return 'Tidsgrænsen skal være over 0 og højst 600 sekunder.'
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
