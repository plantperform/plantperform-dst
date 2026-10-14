import { useCropCodes, useRotationCandidateOptions } from '@/api/hooks'
import type {
  FieldRecord,
  OptimizationConstraints,
  OptimizationSettings,
} from '@/api/types'
import {
  useCatchmentOptions,
  catchmentKey,
} from '@/components/farm/catchment-options'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'

type Props = {
  farmId: string
  fields: FieldRecord[]
  variants: string[]
  settings: OptimizationSettings
  constraints: OptimizationConstraints
  onSettingsChange: (settings: OptimizationSettings) => void
  onConstraintsChange: (constraints: OptimizationConstraints) => void
}

export function SimulationOptimizationOptions({
  farmId,
  fields,
  variants,
  settings,
  constraints,
  onSettingsChange,
  onConstraintsChange,
}: Props) {
  const catchments = useCatchmentOptions(farmId, fields)
  const crops = useCropCodes(farmId)
  const options = useRotationCandidateOptions(farmId)
  const names = new Set(
    (options.data ?? [])
      .filter((option) => variants.includes(option.ref.rotationVariant))
      .flatMap((option) => option.cropSequence),
  )
  const patch = (value: Partial<OptimizationSettings>) =>
    onSettingsChange({ ...settings, ...value })
  return (
    <div className="space-y-5">
      {settings.kind === 'yearly' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="simulation-db2-swing">
              Maks. udsving i DB2 mellem år (%)
            </Label>
            <Input
              id="simulation-db2-swing"
              type="number"
              min="0"
              placeholder="Ingen grænse"
              value={settings.db2SwingPct ?? ''}
              onChange={(event) =>
                patch({
                  db2SwingPct:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </div>
          {catchments.map((catchment) => {
            const cap = settings.maxNLoadByCatchment.find(
              (cap) => cap.catchmentId === catchment.catchmentId,
            )
            return (
              <fieldset
                key={catchmentKey(catchment.catchmentId)}
                className="space-y-2 rounded-md border p-3"
              >
                <legend className="px-1 text-sm font-medium">
                  Årligt udledningsloft: {catchment.label}
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ROTATION_CALENDAR_YEARS.map((year) => (
                    <label key={year} className="space-y-1 text-xs">
                      {year}
                      <Input
                        type="number"
                        min="0"
                        placeholder="Ingen grænse"
                        value={cap?.maxNLoadByYear[year] ?? ''}
                        onChange={(event) => {
                          const maxNLoadByYear = { ...cap?.maxNLoadByYear }
                          if (event.target.value === '')
                            delete maxNLoadByYear[year]
                          else maxNLoadByYear[year] = Number(event.target.value)
                          patch({
                            maxNLoadByCatchment: [
                              ...settings.maxNLoadByCatchment.filter(
                                (cap) =>
                                  cap.catchmentId !== catchment.catchmentId,
                              ),
                              {
                                catchmentId: catchment.catchmentId,
                                maxNLoadByYear,
                              },
                            ],
                          })
                        }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}
        </>
      ) : (
        catchments.map((catchment) => (
          <label
            key={catchmentKey(catchment.catchmentId)}
            className="block space-y-1 text-sm"
          >
            Maks. gennemsnitlig udledning: {catchment.label} (kg N)
            <Input
              type="number"
              min="0"
              placeholder={
                constraints.maxNLoadByCatchment.some(
                  (cap) => cap.catchmentId === catchment.catchmentId,
                )
                  ? 'Ingen grænse'
                  : 'Bedriftens kvote'
              }
              value={
                constraints.maxNLoadByCatchment.find(
                  (cap) => cap.catchmentId === catchment.catchmentId,
                )?.maxNLoadKg ?? ''
              }
              onChange={(event) =>
                onConstraintsChange({
                  ...constraints,
                  maxNLoadByCatchment: [
                    ...constraints.maxNLoadByCatchment.filter(
                      (cap) => cap.catchmentId !== catchment.catchmentId,
                    ),
                    {
                      catchmentId: catchment.catchmentId,
                      maxNLoadKg:
                        event.target.value === ''
                          ? null
                          : Number(event.target.value),
                    },
                  ],
                })
              }
            />
          </label>
        ))
      )}
      <div className="grid grid-cols-2 gap-3">
        {(['minFeedUnits', 'maxFeedUnits'] as const).map((key, index) => (
          <label key={key} className="space-y-1 text-sm">
            {index === 0 ? 'Min. foderenheder' : 'Maks. foderenheder'}
            <Input
              type="number"
              min="0"
              placeholder="Ingen grænse"
              value={constraints[key] ?? ''}
              onChange={(event) =>
                onConstraintsChange({
                  ...constraints,
                  [key]:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">
          Arealgrænser for afgrøder (ha)
        </legend>
        {constraints.cropAreaLimits.map((limit) => (
          <div
            key={limit.cropCode}
            className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2"
          >
            <span className="text-sm">
              {crops.data?.find((crop) => crop.code === limit.cropCode)?.name ??
                limit.cropCode}
            </span>
            {(['minAreaHa', 'maxAreaHa'] as const).map((key, index) => (
              <label key={key} className="space-y-1 text-xs">
                {index === 0 ? 'Minimum' : 'Maksimum'}
                <Input
                  type="number"
                  min="0"
                  placeholder="Ingen"
                  value={limit[key] ?? ''}
                  onChange={(event) =>
                    onConstraintsChange({
                      ...constraints,
                      cropAreaLimits: constraints.cropAreaLimits.map((value) =>
                        value.cropCode === limit.cropCode
                          ? {
                              ...value,
                              [key]:
                                event.target.value === ''
                                  ? null
                                  : Number(event.target.value),
                            }
                          : value,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              type="button"
              className="px-2 py-2 text-sm underline"
              onClick={() =>
                onConstraintsChange({
                  ...constraints,
                  cropAreaLimits: constraints.cropAreaLimits.filter(
                    (value) => value.cropCode !== limit.cropCode,
                  ),
                })
              }
            >
              Fjern
            </button>
          </div>
        ))}
        <select
          aria-label="Tilføj arealgrænse for en afgrøde"
          value=""
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          onChange={(event) => {
            if (event.target.value)
              onConstraintsChange({
                ...constraints,
                cropAreaLimits: [
                  ...constraints.cropAreaLimits,
                  {
                    cropCode: Number(event.target.value),
                    minAreaHa: 0,
                    maxAreaHa: null,
                  },
                ],
              })
          }}
        >
          <option value="">Tilføj afgrøde...</option>
          {(crops.data ?? [])
            .filter(
              (crop) =>
                names.has(crop.name) &&
                !constraints.cropAreaLimits.some(
                  (limit) => limit.cropCode === crop.code,
                ),
            )
            .map((crop) => (
              <option key={crop.code} value={crop.code}>
                {crop.name}
              </option>
            ))}
        </select>
      </fieldset>
      <div className="space-y-2">
        <Label>Afgrøder i de valgte sædskifter</Label>
        {crops.error || options.error ? (
          <LoadError
            message="Kunne ikke hente afgrøder."
            onRetry={() => {
              void crops.mutate()
              void options.mutate()
            }}
          />
        ) : null}
        {crops.isLoading || options.isLoading ? (
          <p className="text-sm text-muted-foreground">Henter afgrøder...</p>
        ) : null}
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
          {(crops.data ?? [])
            .filter((crop) => names.has(crop.name))
            .map((crop) => (
              <label key={crop.code} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!settings.excludedCropCodes.includes(crop.code)}
                  onChange={(event) =>
                    patch({
                      excludedCropCodes: event.target.checked
                        ? settings.excludedCropCodes.filter(
                            (code) => code !== crop.code,
                          )
                        : [...settings.excludedCropCodes, crop.code],
                    })
                  }
                />
                {crop.name}
              </label>
            ))}
        </div>
      </div>
    </div>
  )
}
