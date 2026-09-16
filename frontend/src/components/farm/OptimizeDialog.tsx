import { zodResolver } from '@hookform/resolvers/zod'
import { SlidersHorizontal } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { mutate } from 'swr'

import { simulationFieldsKey, useScenarioCropCodes } from '@/api/hooks'
import { runSimulationOptimization } from '@/api/mutations'
import type {
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DialogActionBar } from '@/components/ui/dialog-action-bar'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatNumber } from '@/lib/field-domain'
import {
  DEFAULT_OPTIMIZE_FORM_VALUES,
  MAX_TIME_LIMIT_SECONDS,
  optimizeFormSchema,
  toOptimizeSimulationInput,
  toggleCropCode,
  type OptimizeFormValues,
} from '@/lib/optimization-form'

type OptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
  onOpenRules: () => void
}

const formatLimit = (value: number | null, unit: string) =>
  value === null ? 'Ingen grænse' : `${formatNumber(value)} ${unit}`

export const OptimizeDialog = ({
  farmId,
  simulation,
  fields,
  open,
  onOpenChange,
  onOptimized,
  onOpenRules,
}: OptimizeDialogProps) => {
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const { data: crops = [] } = useScenarioCropCodes(farmId, simulation.id)
  const resolver = useMemo(
    () => zodResolver(optimizeFormSchema(crops.map((crop) => crop.code))),
    [crops],
  )
  const {
    register,
    control,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors },
  } = useForm<OptimizeFormValues>({
    defaultValues: DEFAULT_OPTIMIZE_FORM_VALUES,
    resolver,
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const excludedCropCodes = useWatch({ control, name: 'excludedCropCodes' })

  const catchments = useCatchmentOptions(farmId, fields)
  const catchmentLabelByKey = new Map(
    catchments.map((catchment) => [
      catchmentKey(catchment.catchmentId),
      catchment.label,
    ]),
  )
  const { constraints } = simulation

  // The time limit is kept for the next run; excluded crops are not.
  const handleOpenChange = (nextOpen: boolean) => {
    if (isRunning) return
    if (!nextOpen) {
      setRunError(null)
      setValue('excludedCropCodes', [], { shouldValidate: true })
    }
    onOpenChange(nextOpen)
  }

  const toggleCrop = (code: number) =>
    setValue(
      'excludedCropCodes',
      toggleCropCode(getValues('excludedCropCodes'), code),
      { shouldValidate: true },
    )

  const runOptimization = async (values: OptimizeFormValues) => {
    setIsRunning(true)
    setRunError(null)
    try {
      const response = await runSimulationOptimization(
        farmId,
        simulation.id,
        toOptimizeSimulationInput(values),
      )
      await mutate(
        simulationFieldsKey(farmId, simulation.id),
        response.fields,
        { revalidate: false },
      )
      await invalidateOptimizationDisplays(farmId, simulation.id)
      onOptimized(response)
      setRunError(null)
      setValue('excludedCropCodes', [])
      onOpenChange(false)
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : 'Kunne ikke køre optimeringen.',
      )
      // The error is shown above the fields, which may be scrolled away.
      bodyRef.current?.scrollTo({ top: 0 })
    } finally {
      setIsRunning(false)
    }
  }

  const errorCount = Object.keys(errors).length
  const timeLimitError = errors.timeLimitSeconds?.message

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!isRunning}
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 max-sm:max-h-[calc(100dvh-2rem)]"
      >
        <DialogHeader className="border-b px-6 pt-6 pb-4 pr-12">
          <DialogTitle>Optimér {simulation.name}</DialogTitle>
          <DialogDescription>
            Kør optimeringen med de regler, der er gemt på simuleringen.
          </DialogDescription>
        </DialogHeader>

        <form
          id="optimize-form"
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={(event) => void handleSubmit(runOptimization)(event)}
        >
          <div
            ref={bodyRef}
            className="min-h-0 space-y-5 overflow-y-auto px-6 py-5"
          >
            {runError ? (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700"
              >
                {runError}
              </p>
            ) : null}

            <div className="space-y-2 rounded-lg border border-rules/30 bg-rules/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <SlidersHorizontal
                  className="h-4 w-4 text-rules"
                  aria-hidden="true"
                />
                Gældende grænser
              </div>
              <dl className="grid gap-2 text-xs sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <dt className="text-muted-foreground">Maks. udledning</dt>
                  <dd>
                    {constraints.maxNLoadByCatchment.length === 0 ? (
                      'Ingen grænse'
                    ) : (
                      <ul className="space-y-0.5">
                        {constraints.maxNLoadByCatchment.map((cap) => {
                          const key = catchmentKey(cap.catchmentId)
                          const label =
                            catchmentLabelByKey.get(key) ??
                            (cap.catchmentId === null
                              ? 'Uden kystvandopland'
                              : `Kystvandopland ${cap.catchmentId}`)
                          return (
                            <li key={key}>
                              {label}: {formatLimit(cap.maxNLoadKg, 'kg N')}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Min. foderenheder</dt>
                  <dd>{formatLimit(constraints.minFeedUnits, 'FE')}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Maks. foderenheder</dt>
                  <dd>{formatLimit(constraints.maxFeedUnits, 'FE')}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Ændres under <strong>Regler</strong> - ikke her.{' '}
                <button
                  type="button"
                  className="rounded-sm font-medium text-rules underline underline-offset-2 hover:text-rules/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  onClick={onOpenRules}
                >
                  Åbn Regler
                </button>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="optimize-time-limit">Tidsgrænse (sekunder)</Label>
              <Input
                id="optimize-time-limit"
                type="number"
                min="1"
                max={MAX_TIME_LIMIT_SECONDS}
                aria-invalid={Boolean(timeLimitError)}
                aria-describedby={
                  timeLimitError
                    ? 'optimize-time-limit-error'
                    : 'optimize-time-limit-help'
                }
                readOnly={isRunning}
                {...register('timeLimitSeconds')}
              />
              <FieldError
                id="optimize-time-limit-error"
                message={timeLimitError}
              />
              <p
                id="optimize-time-limit-help"
                className="text-xs text-muted-foreground"
              >
                Højst {MAX_TIME_LIMIT_SECONDS} sekunder - sæt højere, hvis
                optimeringen ikke når at finde en løsning i tide på en stor
                bedrift.
              </p>
            </div>

            <CropExclusionList
              id="optimize-crops"
              crops={crops}
              excludedCodes={excludedCropCodes}
              onToggle={toggleCrop}
              error={errors.excludedCropCodes?.message}
            />
          </div>

          <DialogActionBar
            message={
              errorCount > 0 ? (
                <p className="font-medium text-destructive">
                  Ret {errorCount} {errorCount === 1 ? 'felt' : 'felter'} før
                  du kører optimeringen
                </p>
              ) : isRunning ? (
                <p className="text-muted-foreground">
                  Optimerer - det kan tage op til tidsgrænsen.
                </p>
              ) : null
            }
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={isRunning}
                >
                  Annuller
                </Button>
                <Button type="submit" disabled={isRunning}>
                  {isRunning ? 'Arbejder...' : 'Kør optimering'}
                </Button>
              </>
            }
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}
