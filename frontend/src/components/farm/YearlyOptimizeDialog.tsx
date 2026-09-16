import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  useYearlyOptimizationCandidates,
} from '@/api/hooks'
import { runYearlySimulationOptimization } from '@/api/mutations'
import type {
  CatchmentYearlyNLoadCaps,
  FieldRecord,
  OptimizeSimulationResponse,
  Simulation,
} from '@/api/types'
import {
  catchmentKey,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { CropExclusionList } from '@/components/farm/CropExclusionList'
import { invalidateOptimizationDisplays } from '@/components/farm/optimization-run'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'

type CatchmentYearlyInput = {
  sameForAllYears: boolean
  uniform: string
  perYear: Record<number, string>
}

const DEFAULT_CATCHMENT_YEARLY_INPUT: CatchmentYearlyInput = {
  sameForAllYears: true,
  uniform: '',
  perYear: {},
}

type YearlyOptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
}

export const YearlyOptimizeDialog = ({
  farmId,
  simulation,
  fields,
  open,
  onOpenChange,
  onOptimized,
}: YearlyOptimizeDialogProps) => {
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(20)
  const [catchmentInputs, setCatchmentInputs] = useState<
    Record<string, CatchmentYearlyInput>
  >({})
  const [db2SwingPct, setDb2SwingPct] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [excludedCropCodes, setExcludedCropCodes] = useState<Set<number>>(
    new Set(),
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRunError(null)
      setExcludedCropCodes(new Set())
    }
    onOpenChange(nextOpen)
  }

  const toggleCrop = (code: number) => {
    setExcludedCropCodes((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const { data: categories = [] } = useYearlyOptimizationCandidates(
    farmId,
    simulation.id,
  )
  const catchments = useCatchmentOptions(farmId, fields)

  const catchmentInput = (key: string): CatchmentYearlyInput =>
    catchmentInputs[key] ?? DEFAULT_CATCHMENT_YEARLY_INPUT

  const updateCatchmentInput = (
    key: string,
    patch: Partial<CatchmentYearlyInput>,
  ) => {
    setCatchmentInputs((current) => ({
      ...current,
      [key]: { ...catchmentInput(key), ...patch },
    }))
  }

  // Estimate, not a guarantee. Every candidate may be shifted.
  const estimatedSeconds = useMemo(() => {
    let totalShiftUnits = 0
    for (const category of categories) {
      for (const option of category.rotations) {
        totalShiftUnits += option.activeLen
      }
    }
    return fields.length * totalShiftUnits * 0.002
  }, [fields.length, categories])

  const runYearlyOptimization = async () => {
    const maxNLoadByCatchment: CatchmentYearlyNLoadCaps[] = catchments.map(
      (catchment) => {
        const key = catchmentKey(catchment.catchmentId)
        const input = catchmentInput(key)
        const maxNLoadByYear: Record<number, number> = {}
        if (input.sameForAllYears) {
          const trimmed = input.uniform.trim()
          if (trimmed !== '') {
            for (const year of ROTATION_CALENDAR_YEARS) {
              maxNLoadByYear[year] = Number(trimmed)
            }
          }
        } else {
          for (const [year, value] of Object.entries(input.perYear)) {
            const trimmed = value.trim()
            if (trimmed !== '') {
              maxNLoadByYear[Number(year)] = Number(trimmed)
            }
          }
        }
        return { catchmentId: catchment.catchmentId, maxNLoadByYear }
      },
    )
    const trimmedSwing = db2SwingPct.trim()
    setIsRunning(true)
    try {
      const response = await runYearlySimulationOptimization(
        farmId,
        simulation.id,
        {
          timeLimitSeconds,
          maxNLoadByCatchment,
          db2SwingPct: trimmedSwing === '' ? null : Number(trimmedSwing),
          excludedCropCodes: Array.from(excludedCropCodes),
        },
      )
      await mutate(
        simulationFieldsKey(farmId, simulation.id),
        response.fields,
        { revalidate: false },
      )
      await invalidateOptimizationDisplays(farmId, simulation.id)
      onOptimized(response)
      handleOpenChange(false)
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : 'Kunne ikke køre års-optimeringen.',
      )
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Års-optimering - {simulation.name}</DialogTitle>
          <DialogDescription>
            Optimér med udledningsloft pr. kalenderår og en grænse for hvor
            meget dækningsbidraget må svinge år til år. Alle sædskifter kan
            rykkes frem eller tilbage i deres cyklus.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <p className="text-xs text-amber-900">
            Indstillingerne herunder gælder <strong>kun denne kørsel</strong> og
            gemmes ikke på simuleringen - de nulstilles, når dialogen lukkes, og
            vises derfor ikke under Regler. Noter dem, hvis du skal kunne
            gentage kørslen.
          </p>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="yearly-time-limit">Tidsgrænse</Label>
            <Input
              id="yearly-time-limit"
              type="number"
              min="1"
              max="600"
              value={timeLimitSeconds}
              onChange={(event) =>
                setTimeLimitSeconds(Number(event.target.value))
              }
            />
            <p className="text-xs text-muted-foreground">sekunder</p>
          </div>

          <div className="space-y-3">
            <Label>Maks. tilladt udledning pr. år, pr. kystvandopland</Label>
            {catchments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ingen marker med et kystvandopland i denne simulering.
              </p>
            ) : (
              catchments.map((catchment) => {
                const key = catchmentKey(catchment.catchmentId)
                const input = catchmentInput(key)
                return (
                  <div key={key} className="space-y-2 rounded border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {catchment.label}
                      </span>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={input.sameForAllYears}
                          onChange={(event) =>
                            updateCatchmentInput(key, {
                              sameForAllYears: event.target.checked,
                            })
                          }
                        />
                        Samme grænse for alle år
                      </label>
                    </div>
                    {input.sameForAllYears ? (
                      <div className="space-y-1">
                        <Input
                          type="number"
                          min="0"
                          value={input.uniform}
                          placeholder="Ingen grænse"
                          onChange={(event) =>
                            updateCatchmentInput(key, {
                              uniform: event.target.value,
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          kg N, gælder hvert år
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-4">
                        {ROTATION_CALENDAR_YEARS.map((year) => (
                          <label key={year} className="space-y-1 text-sm">
                            <span className="text-xs text-muted-foreground">
                              {year}
                            </span>
                            <Input
                              type="number"
                              min="0"
                              value={input.perYear[year] ?? ''}
                              placeholder="Ingen grænse"
                              onChange={(event) =>
                                updateCatchmentInput(key, {
                                  perYear: {
                                    ...input.perYear,
                                    [year]: event.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="yearly-db-swing">
              Maks. udsving i DB2 mellem år
            </Label>
            <Input
              id="yearly-db-swing"
              type="number"
              min="0"
              value={db2SwingPct}
              placeholder="Ingen grænse"
              onChange={(event) => setDb2SwingPct(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              % - intet års samlede DB2 må afvige mere end dette fra
              gennemsnittet af simuleringens år
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Alle sædskifter kan forskydes · {fields.length} marker · ~
            {estimatedSeconds < 1 ? '<1' : Math.round(estimatedSeconds)} sek.
            (estimat, ikke en garanti)
          </p>

          <CropExclusionList
            farmId={farmId}
            simulationId={simulation.id}
            excludedCodes={excludedCropCodes}
            onToggle={toggleCrop}
          />
        </div>

        {runError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700">
            {runError}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Annuller
          </Button>
          <Button
            onClick={() => void runYearlyOptimization()}
            disabled={isRunning}
          >
            {isRunning ? 'Arbejder...' : 'Kør års-optimering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
