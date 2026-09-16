import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Info } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useForm, useWatch, type FieldErrors } from 'react-hook-form'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  useScenarioCropCodes,
  useYearlyOptimizationCandidates,
} from '@/api/hooks'
import { runYearlySimulationOptimization } from '@/api/mutations'
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
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StepDialog, type StepDialogStep } from '@/components/ui/step-dialog'
import { useStepNavigation } from '@/hooks/use-step-navigation'
import { ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'
import { MAX_TIME_LIMIT_SECONDS, toggleCropCode } from '@/lib/optimization-form'
import {
  DEFAULT_YEARLY_OPTIMIZE_FORM_VALUES,
  YEARLY_OPTIMIZE_FORM_STEPS,
  catchmentCapInput,
  catchmentCapKey,
  invalidStepIndexes,
  toYearlyOptimizeSimulationInput,
  withSameForAllYears,
  yearlyOptimizeFormSchema,
  type CatchmentCapInput,
  type YearlyOptimizeFormValues,
} from '@/lib/yearly-optimization-form'

type YearlyOptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
}

const LAST_STEP_INDEX = YEARLY_OPTIMIZE_FORM_STEPS.length - 1

// Counts the messages under a part of the errors, which nests per catchment
// and per year.
const countErrorMessages = (node: unknown): number => {
  if (!node || typeof node !== 'object') return 0
  if (typeof (node as { message?: unknown }).message === 'string') return 1
  return Object.entries(node).reduce(
    (count, [key, child]) =>
      key === 'ref' ? count : count + countErrorMessages(child),
    0,
  )
}

type CatchmentCapErrors = FieldErrors<CatchmentCapInput> | undefined

export const YearlyOptimizeDialog = ({
  farmId,
  simulation,
  fields,
  open,
  onOpenChange,
  onOptimized,
}: YearlyOptimizeDialogProps) => {
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const { data: crops = [], isLoading: cropsLoading } = useScenarioCropCodes(
    farmId,
    simulation.id,
  )
  const { data: categories = [] } = useYearlyOptimizationCandidates(
    farmId,
    simulation.id,
  )
  const catchments = useCatchmentOptions(farmId, fields)

  const schema = useMemo(
    () => yearlyOptimizeFormSchema(crops.map((crop) => crop.code)),
    [crops],
  )
  const resolver = useMemo(() => zodResolver(schema), [schema])

  // The form lives outside the dialog content, so closing the dialog keeps the
  // input for the next run of this simulation.
  const {
    register,
    control,
    setValue,
    getValues,
    getFieldState,
    trigger,
    reset,
    formState: { errors, isDirty },
  } = useForm<YearlyOptimizeFormValues>({
    defaultValues: DEFAULT_YEARLY_OPTIMIZE_FORM_VALUES,
    resolver,
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const values = useWatch({ control }) as YearlyOptimizeFormValues

  // Values set outside a native input revalidate like typed ones: only once
  // the field has been touched.
  const updateValue = <K extends keyof YearlyOptimizeFormValues>(
    name: K,
    value: YearlyOptimizeFormValues[K],
  ) =>
    setValue(name, value as never, {
      shouldDirty: true,
      shouldValidate: getFieldState(name).isTouched,
    })

  const validateStep = async (index: number) => {
    const names = [...YEARLY_OPTIMIZE_FORM_STEPS[index].fields]
    const valid = await trigger(names, { shouldFocus: true })
    if (!valid) {
      for (const name of names) {
        setValue(name, getValues(name) as never, { shouldTouch: true })
      }
      // The limits are not registered inputs, so focus is moved here instead.
      requestAnimationFrame(() =>
        contentRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      )
    }
    return valid
  }

  const {
    stepIndex,
    furthestStepIndex,
    goToStep,
    validateAllSteps,
    resetSteps,
  } = useStepNavigation(validateStep)

  // A failed run's message belongs to that attempt, not to the step shown next.
  const navigate = (index: number) => {
    setRunError(null)
    void goToStep(index)
  }

  const startOver = () => {
    reset(DEFAULT_YEARLY_OPTIMIZE_FORM_VALUES)
    resetSteps()
    setRunError(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setRunError(null)
    onOpenChange(nextOpen)
  }

  const updateCatchmentCap = (key: string, input: CatchmentCapInput) =>
    updateValue('catchmentCaps', {
      ...getValues('catchmentCaps'),
      [catchmentCapKey(key)]: input,
    })

  // A limit is checked when it loses focus, like a registered input.
  const touchCatchmentCaps = () =>
    setValue('catchmentCaps', getValues('catchmentCaps'), {
      shouldTouch: true,
      shouldValidate: true,
    })

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
    if (!(await validateAllSteps(YEARLY_OPTIMIZE_FORM_STEPS.length))) return

    setIsRunning(true)
    setRunError(null)
    try {
      const response = await runYearlySimulationOptimization(
        farmId,
        simulation.id,
        toYearlyOptimizeSimulationInput(
          getValues(),
          catchments.map((catchment) => ({
            catchmentId: catchment.catchmentId,
            key: catchmentKey(catchment.catchmentId),
          })),
        ),
      )
      await mutate(
        simulationFieldsKey(farmId, simulation.id),
        response.fields,
        { revalidate: false },
      )
      await invalidateOptimizationDisplays(farmId, simulation.id)
      onOptimized(response)
      handleOpenChange(false)
      // The input is kept, so a follow-up run starts from the first step.
      void goToStep(0)
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

  const invalidSteps = invalidStepIndexes(schema, values)
  const steps: StepDialogStep[] = YEARLY_OPTIMIZE_FORM_STEPS.map(
    (step, index) => ({
      id: step.id,
      label: step.label,
      status:
        index > furthestStepIndex
          ? 'upcoming'
          : invalidSteps.has(index)
            ? 'invalid'
            : 'complete',
    }),
  )

  const stepErrorCount = YEARLY_OPTIMIZE_FORM_STEPS[stepIndex].fields.reduce(
    (count, name) => count + countErrorMessages(errors[name]),
    0,
  )

  const footerMessage = runError ? (
    <p className="font-medium text-destructive">
      Kørslen fejlede - se beskeden ovenfor
    </p>
  ) : stepErrorCount > 0 ? (
    <p className="font-medium text-destructive">
      Ret {stepErrorCount} {stepErrorCount === 1 ? 'felt' : 'felter'} før du
      fortsætter
    </p>
  ) : isRunning ? (
    <p className="text-muted-foreground">
      Optimerer - det kan tage op til tidsgrænsen.
    </p>
  ) : null

  const timeLimit = Number(values.timeLimitSeconds)
  const estimateExceedsLimit =
    !errors.timeLimitSeconds && timeLimit > 0 && estimatedSeconds > timeLimit
  const db2SwingError = errors.db2SwingPct?.message
  const timeLimitError = errors.timeLimitSeconds?.message

  return (
    <StepDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={`Års-optimering - ${simulation.name}`}
      description="Optimér med udledningsloft pr. kalenderår og en grænse for, hvor meget dækningsbidraget må svinge år til år. Alle sædskifter kan rykkes frem eller tilbage i deres cyklus."
      steps={steps}
      currentIndex={stepIndex}
      onStepSelect={navigate}
      locked={isRunning}
      footerMessage={footerMessage}
      secondaryAction={
        stepIndex === 0 && isDirty ? (
          <Button variant="ghost" size="sm" onClick={startOver}>
            Start forfra
          </Button>
        ) : null
      }
      actions={
        <>
          {stepIndex > 0 ? (
            <Button
              variant="outline"
              onClick={() => navigate(stepIndex - 1)}
              disabled={isRunning}
            >
              Tilbage
            </Button>
          ) : null}
          {stepIndex === LAST_STEP_INDEX ? (
            <Button
              onClick={() => void runYearlyOptimization()}
              disabled={isRunning}
            >
              {isRunning ? 'Arbejder...' : 'Kør års-optimering'}
            </Button>
          ) : (
            <Button onClick={() => navigate(stepIndex + 1)}>Næste</Button>
          )}
        </>
      }
    >
      <div ref={contentRef} className="space-y-6">
        {runError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700"
          >
            {runError}
          </p>
        ) : null}

        {stepIndex === 0 ? (
          <>
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                aria-hidden="true"
              />
              <p className="text-xs text-amber-900">
                Indstillingerne gælder <strong>kun denne kørsel</strong> og
                gemmes ikke på simuleringen - de vises derfor ikke under Regler.
                Noter dem, hvis du skal kunne gentage kørslen senere.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Maks. tilladt udledning pr. år, pr. kystvandopland</Label>
                <p className="text-xs text-muted-foreground">
                  kg N. Lad feltet stå tomt for ingen grænse.
                </p>
              </div>
              {catchments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Ingen marker med et kystvandopland i denne simulering.
                </p>
              ) : (
                catchments.map((catchment) => {
                  const key = catchmentKey(catchment.catchmentId)
                  const input = catchmentCapInput(values, key)
                  const capErrors = errors.catchmentCaps?.[
                    catchmentCapKey(key)
                  ] as CatchmentCapErrors
                  const idPrefix = `yearly-cap-${key}`
                  return (
                    <div key={key} className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {catchment.label}
                        </span>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={input.sameForAllYears}
                            onChange={(event) =>
                              updateCatchmentCap(
                                key,
                                withSameForAllYears(input, event.target.checked),
                              )
                            }
                          />
                          Samme grænse for alle år
                        </label>
                      </div>
                      {input.sameForAllYears ? (
                        <div className="space-y-1">
                          <Input
                            id={`${idPrefix}-uniform`}
                            type="number"
                            min="0"
                            aria-label={`${catchment.label}, kg N pr. år`}
                            aria-invalid={Boolean(capErrors?.uniform)}
                            aria-describedby={
                              capErrors?.uniform
                                ? `${idPrefix}-uniform-error`
                                : undefined
                            }
                            value={input.uniform}
                            placeholder="Ingen grænse"
                            onChange={(event) =>
                              updateCatchmentCap(key, {
                                ...input,
                                uniform: event.target.value,
                              })
                            }
                            onBlur={touchCatchmentCaps}
                          />
                          <FieldError
                            id={`${idPrefix}-uniform-error`}
                            message={capErrors?.uniform?.message}
                          />
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {ROTATION_CALENDAR_YEARS.map((year, index) => {
                            const yearError = capErrors?.perYear?.[index]?.message
                            return (
                              <label key={year} className="space-y-1 text-sm">
                                <span className="text-xs text-muted-foreground">
                                  {year}
                                </span>
                                <Input
                                  type="number"
                                  min="0"
                                  aria-invalid={Boolean(yearError)}
                                  aria-describedby={
                                    yearError
                                      ? `${idPrefix}-${year}-error`
                                      : undefined
                                  }
                                  value={input.perYear[index] ?? ''}
                                  placeholder="Ingen grænse"
                                  onChange={(event) =>
                                    updateCatchmentCap(key, {
                                      ...input,
                                      perYear: input.perYear.map(
                                        (value, current) =>
                                          current === index
                                            ? event.target.value
                                            : value,
                                      ),
                                    })
                                  }
                                  onBlur={touchCatchmentCaps}
                                />
                                <FieldError
                                  id={`${idPrefix}-${year}-error`}
                                  message={yearError}
                                />
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="yearly-db-swing">
                Maks. udsving i DB2 mellem år (%)
              </Label>
              <Input
                id="yearly-db-swing"
                type="number"
                min="0"
                placeholder="Ingen grænse"
                aria-invalid={Boolean(db2SwingError)}
                aria-describedby={
                  db2SwingError ? 'yearly-db-swing-error' : 'yearly-db-swing-help'
                }
                {...register('db2SwingPct')}
              />
              <FieldError id="yearly-db-swing-error" message={db2SwingError} />
              <p
                id="yearly-db-swing-help"
                className="text-xs text-muted-foreground"
              >
                Intet års samlede DB2 må afvige mere end dette fra gennemsnittet
                af simuleringens år.
              </p>
            </div>
          </>
        ) : null}

        {stepIndex === 1 ? (
          cropsLoading ? (
            <p className="text-sm text-muted-foreground">Henter afgrøder...</p>
          ) : crops.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Simuleringen har ingen afgrøder at fravælge.
            </p>
          ) : (
            <CropExclusionList
              id="yearly-crops"
              crops={crops}
              excludedCodes={values.excludedCropCodes}
              onToggle={(code) =>
                setValue(
                  'excludedCropCodes',
                  toggleCropCode(getValues('excludedCropCodes'), code),
                  { shouldDirty: true, shouldValidate: true },
                )
              }
              error={errors.excludedCropCodes?.message}
            />
          )
        ) : null}

        {stepIndex === 2 ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="yearly-time-limit">Tidsgrænse (sekunder)</Label>
              <Input
                id="yearly-time-limit"
                type="number"
                min="1"
                max={MAX_TIME_LIMIT_SECONDS}
                aria-invalid={Boolean(timeLimitError)}
                aria-describedby={
                  timeLimitError
                    ? 'yearly-time-limit-error'
                    : 'yearly-time-limit-help'
                }
                readOnly={isRunning}
                {...register('timeLimitSeconds')}
              />
              <FieldError
                id="yearly-time-limit-error"
                message={timeLimitError}
              />
              <p
                id="yearly-time-limit-help"
                className="text-xs text-muted-foreground"
              >
                Højst {MAX_TIME_LIMIT_SECONDS} sekunder.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Alle sædskifter kan forskydes · {fields.length} marker · ~
              {estimatedSeconds < 1 ? '<1' : Math.round(estimatedSeconds)} sek.
              (estimat, ikke en garanti)
            </p>

            {estimateExceedsLimit ? (
              <p className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                Estimatet er længere end tidsgrænsen. Hæv tidsgrænsen, hvis
                optimeringen ikke når at finde en løsning.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </StepDialog>
  )
}
