import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationsKey,
  useFertiliserPresets,
  useRotationCategories,
  useRotationNNormPercentages,
} from '@/api/hooks'
import { createSimulation } from '@/api/mutations'
import type {
  FieldRecord,
  FertiliserSettings,
  Simulation,
} from '@/api/types'
import { LoadingSkeleton } from '@/components/farm/LoadingSkeleton'
import { RotationPicker } from '@/components/farm/RotationPicker'
import { SimulationSummary } from '@/components/farm/SimulationSummary'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { StepDialog, type StepDialogStep } from '@/components/ui/step-dialog'
import { formatNumber } from '@/lib/field-domain'
import {
  SOWING_DATE_OPTIONS,
  SOWING_DATE_INTERVALS,
  sowingDateEffectPercent,
} from '@/lib/nles5-detail-labels'
import {
  CUSTOM_FERTILISER,
  DEFAULT_SIMULATION_FORM_VALUES,
  NO_FERTILISER,
  SIMULATION_FORM_STEPS,
  catchCropSowingDateOf,
  fertiliserFieldsForChoice,
  isPresetModified,
  isStepValid,
  simulationFormSchema,
  stepFields,
  toCreateSimulationInput,
  toggleValue,
  type SimulationFormValues,
} from '@/lib/simulation-form'
import { cn } from '@/lib/utils'

type NewScenarioPanelProps = {
  farmId: string
  fields: FieldRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSimulationCreated: (simulation: Simulation) => void
  onError: (message: string | null) => void
}

const LAST_STEP_INDEX = SIMULATION_FORM_STEPS.length - 1

const FERTILISER_NUMBER_FIELDS: (keyof SimulationFormValues)[] = [
  'orgMineralN',
  'mineralSharePct',
  'nContentKgPerTon',
]

export const NewScenarioPanel = ({
  farmId,
  fields,
  open,
  onOpenChange,
  onSimulationCreated,
  onError,
}: NewScenarioPanelProps) => {
  const categoriesQuery = useRotationCategories(farmId)
  const nNormQuery = useRotationNNormPercentages(farmId)
  const presetsQuery = useFertiliserPresets(farmId)
  const categories = categoriesQuery.data ?? []
  const nNormOptions = nNormQuery.data ?? []
  const fertiliserPresets = presetsQuery.data ?? []
  const referenceQueries = [categoriesQuery, nNormQuery, presetsQuery]
  const referenceLoading = referenceQueries.some((query) => query.isLoading)
  const referenceError = referenceQueries.some((query) => query.error)
  const referenceRetrying = referenceQueries.some(
    (query) => query.isValidating,
  )
  // Steps after the first need the reference data, so hide them until it is in.
  const referenceBlocked = referenceLoading || referenceError
  const stepReachable = (index: number) => index <= 1 || !referenceBlocked
  const retryReferenceData = () => {
    for (const query of referenceQueries) {
      if (query.error) void query.mutate()
    }
  }

  // The form lives outside the dialog content, so closing the dialog keeps the
  // draft until it is created or started over.
  const {
    register,
    control,
    setValue,
    getValues,
    getFieldState,
    trigger,
    reset,
    formState: { errors, isDirty },
  } = useForm<SimulationFormValues>({
    defaultValues: DEFAULT_SIMULATION_FORM_VALUES,
    resolver: zodResolver(simulationFormSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const values = useWatch({ control }) as SimulationFormValues

  const [stepIndex, setStepIndex] = useState(0)
  const [furthestStepIndex, setFurthestStepIndex] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const hasFields = fields.length > 0

  // Values set outside a native input revalidate like typed ones: only once
  // the field has been touched, so an error never appears before it is due.
  const updateValue = <K extends keyof SimulationFormValues>(
    name: K,
    value: SimulationFormValues[K],
  ) =>
    setValue(name, value as never, {
      shouldDirty: true,
      shouldValidate: getFieldState(name).isTouched,
    })

  // Validates one step and shows its errors. Its fields are marked touched,
  // so the errors clear as soon as the input is corrected.
  const validateStep = async (index: number) => {
    const names = stepFields(index)
    const valid = await trigger(names, { shouldFocus: true })
    if (!valid) {
      for (const name of names) {
        setValue(name, getValues(name) as never, { shouldTouch: true })
      }
    }
    return valid
  }

  // Going back never validates. Going forward validates every step passed.
  const goToStep = async (target: number) => {
    if (target <= stepIndex) {
      setStepIndex(target)
      return
    }
    for (let index = stepIndex; index < target; index += 1) {
      if (!(await validateStep(index))) {
        setStepIndex(index)
        return
      }
    }
    setStepIndex(target)
    setFurthestStepIndex((current) => Math.max(current, target))
  }

  const startOver = () => {
    reset(DEFAULT_SIMULATION_FORM_VALUES)
    setStepIndex(0)
    setFurthestStepIndex(0)
    setCreateError(null)
  }

  const applyFertiliserChoice = (choice: string) => {
    updateValue('fertiliserChoice', choice)
    const fertiliserFields = fertiliserFieldsForChoice(
      choice,
      fertiliserPresets,
      getValues('farmingSystem'),
    )
    if (fertiliserFields) {
      updateValue('orgMineralN', fertiliserFields.orgMineralN)
      updateValue('mineralSharePct', fertiliserFields.mineralSharePct)
      updateValue('onlyOrganic', fertiliserFields.onlyOrganic)
    }
    if (FERTILISER_NUMBER_FIELDS.some((name) => errors[name])) {
      void trigger(FERTILISER_NUMBER_FIELDS)
    }
  }

  const catchCropSowingDate = catchCropSowingDateOf(values)
  const presetModified = isPresetModified(values, fertiliserPresets)

  const createScenario = async () => {
    if (!hasFields) return
    for (let index = 0; index <= LAST_STEP_INDEX; index += 1) {
      if (!(await validateStep(index))) {
        setStepIndex(index)
        return
      }
    }

    setIsCreating(true)
    setCreateError(null)
    try {
      const simulation = await createSimulation(
        farmId,
        toCreateSimulationInput(getValues()),
      )
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) => [...current, simulation],
        { revalidate: false },
      )
      await mutate(simulationFieldsKey(farmId, simulation.id))
      void mutate(simulationsKey(farmId))
      onSimulationCreated(simulation)
      onError(null)
      onOpenChange(false)
      startOver()
    } catch {
      setCreateError('Kunne ikke oprette simuleringen. Prøv igen.')
    } finally {
      setIsCreating(false)
    }
  }

  const steps: StepDialogStep[] = SIMULATION_FORM_STEPS.map((step, index) => ({
    id: step.id,
    label: step.label,
    status:
      index > furthestStepIndex
        ? 'upcoming'
        : isStepValid(index, values)
          ? 'complete'
          : 'invalid',
  }))

  const stepErrorCount = stepFields(stepIndex).filter(
    (name) => errors[name],
  ).length

  const footerMessage = createError ? (
    <p className="font-medium text-destructive">{createError}</p>
  ) : stepErrorCount > 0 ? (
    <p className="font-medium text-destructive">
      Ret {stepErrorCount} {stepErrorCount === 1 ? 'felt' : 'felter'} før du
      fortsætter
    </p>
  ) : isCreating ? (
    <p className="text-muted-foreground">
      Beregner sædskifte-kandidater for alle marker - kan tage et øjeblik.
    </p>
  ) : null

  const isLastStep = stepIndex === LAST_STEP_INDEX

  return (
    <StepDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ny simulering"
      description={`Simuleringen oprettes med de ${fields.length} ${
        fields.length === 1 ? 'mark' : 'marker'
      }, der er valgt under Afgrødehistorik.`}
      steps={steps}
      currentIndex={stepIndex}
      onStepSelect={(index) => {
        if (stepReachable(index)) void goToStep(index)
      }}
      locked={isCreating}
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
              onClick={() => void goToStep(stepIndex - 1)}
              disabled={isCreating}
            >
              Tilbage
            </Button>
          ) : null}
          {isLastStep ? (
            <Button
              onClick={() => void createScenario()}
              disabled={!hasFields || referenceBlocked}
              loading={isCreating}
            >
              {isCreating ? 'Opretter simulering...' : 'Opret simulering'}
            </Button>
          ) : (
            <Button
              onClick={() => void goToStep(stepIndex + 1)}
              disabled={!hasFields || !stepReachable(stepIndex + 1)}
            >
              Næste
            </Button>
          )}
        </>
      }
    >
      {stepIndex === 0 ? (
        <div className="space-y-6">
          {!hasFields ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Vælg mindst én mark under Afgrødehistorik, før du opretter en
              simulering.
            </p>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Alle sædskifte-kandidater der matcher dine valg beregnes og gøres
            klar i baggrunden - du bruger derefter Optimér til at vælge det
            bedste sædskifte pr. mark.
          </p>

          <div className="space-y-2">
            <Label htmlFor="scenario-name">Simuleringens navn</Label>
            <Input
              id="scenario-name"
              placeholder="Reduceret kvælstof"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'scenario-name-error' : undefined}
              {...register('name')}
            />
            <FieldError id="scenario-name-error" message={errors.name?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scenario-farming-system">Driftsform</Label>
            <select
              id="scenario-farming-system"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              {...register('farmingSystem', {
                onChange: (event) => {
                  const value = event.target
                    .value as FertiliserSettings['farmingSystem']
                  setValue('onlyOrganic', value === 'Økologisk')
                },
              })}
            >
              <option value="Konventionel">Konventionel</option>
              <option value="Økologisk">Økologisk</option>
            </select>
          </div>
        </div>
      ) : null}

      {stepIndex > 0 && referenceError ? (
        <LoadError
          message="Kunne ikke hente sædskifter, N-norm-niveauer og gødningstyper."
          onRetry={retryReferenceData}
          retrying={referenceRetrying}
        />
      ) : stepIndex > 0 && referenceLoading ? (
        <LoadingSkeleton message="Henter sædskifter og gødningstyper..." />
      ) : null}

      {!referenceBlocked && stepIndex === 1 ? (
        <RotationPicker
          categories={categories}
          farmingSystem={values.farmingSystem}
          rotationVariants={values.rotationVariants}
          onRotationVariantsChange={(next) =>
            updateValue('rotationVariants', next)
          }
          error={errors.rotationVariants?.message}
        />
      ) : null}

      {!referenceBlocked && stepIndex === 2 ? (
        <div className="space-y-6">
          <div className="space-y-3">
            <Label>Gødning</Label>
            <p className="text-xs text-muted-foreground">
              Uafhængig af hvilke sædskifter du har valgt - samme gødningsvalg
              bruges for alle valgte sædskifter i simuleringen.
            </p>
            <div
              role="radiogroup"
              aria-label="Gødningstype"
              className="grid gap-2 sm:grid-cols-2"
            >
              {[
                {
                  value: NO_FERTILISER,
                  label: 'Ingen organisk gødning',
                  detail: 'Ren handelsgødning',
                },
                ...fertiliserPresets.map((preset) => ({
                  value: preset.name,
                  label: preset.name,
                  detail: `${formatNumber(preset.fertiliser.orgMineralN)} kg N/ha · ${formatNumber(preset.fertiliser.mineralSharePct)} % mineralsk`,
                })),
                {
                  value: CUSTOM_FERTILISER,
                  label: 'Brugerdefineret',
                  detail: 'Angiv selv værdierne',
                },
              ].map((option) => {
                const checked = values.fertiliserChoice === option.value
                const modified = checked && presetModified
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      checked
                        ? 'border-primary bg-primary/5'
                        : 'bg-background hover:bg-muted/50',
                    )}
                  >
                    <input
                      type="radio"
                      name="scenario-fertiliser-choice"
                      className="mt-1"
                      checked={checked}
                      onChange={() => applyFertiliserChoice(option.value)}
                    />
                    <span className="min-w-0">
                      <span className="font-medium">
                        {option.label}
                        {modified ? (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            (tilpasset)
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {option.detail}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>

            {presetModified ? (
              <p className="text-xs text-muted-foreground">
                Værdierne afviger fra standarden for {values.fertiliserChoice}.{' '}
                <button
                  type="button"
                  className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => applyFertiliserChoice(values.fertiliserChoice)}
                >
                  Gendan standard
                </button>
              </p>
            ) : null}

            {values.fertiliserChoice !== NO_FERTILISER ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Maks tilladt udnyttet N fra organisk gødning (kg N/ha)
                  </span>
                  <Input
                    type="number"
                    min="0"
                    aria-invalid={Boolean(errors.orgMineralN)}
                    aria-describedby={
                      errors.orgMineralN ? 'scenario-org-n-error' : undefined
                    }
                    {...register('orgMineralN')}
                  />
                  <FieldError
                    id="scenario-org-n-error"
                    message={errors.orgMineralN?.message}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Mineralsk andel (%)
                  </span>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    aria-invalid={Boolean(errors.mineralSharePct)}
                    aria-describedby={
                      errors.mineralSharePct
                        ? 'scenario-mineral-share-error'
                        : undefined
                    }
                    {...register('mineralSharePct')}
                  />
                  <FieldError
                    id="scenario-mineral-share-error"
                    message={errors.mineralSharePct?.message}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Udnyttet N-indhold (kg N/ton)
                  </span>
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    aria-invalid={Boolean(errors.nContentKgPerTon)}
                    aria-describedby={
                      errors.nContentKgPerTon
                        ? 'scenario-n-content-error'
                        : 'scenario-n-content-help'
                    }
                    {...register('nContentKgPerTon')}
                  />
                  <FieldError
                    id="scenario-n-content-error"
                    message={errors.nContentKgPerTon?.message}
                  />
                  <span
                    id="scenario-n-content-help"
                    className="block text-xs text-muted-foreground"
                  >
                    Typisk kvæggylle: 4–7 kg udnyttet N/ton. Bruges til at
                    omregne til ton gødning brugt pr. mark pr. år (reference,
                    ingen beregningseffekt).
                    {(() => {
                      const utilisedPerTon = Number(values.nContentKgPerTon)
                      const mineralPct = Number(values.mineralSharePct)
                      if (!utilisedPerTon || !mineralPct) return null
                      const totalPerTon = utilisedPerTon / (mineralPct / 100)
                      return (
                        <>
                          {' '}
                          Svarer til ca. {totalPerTon.toFixed(1)} kg total N/ton
                          (ved {mineralPct}% mineralsk andel).
                        </>
                      )
                    })()}
                  </span>
                </label>
              </div>
            ) : null}

            {values.fertiliserChoice !== NO_FERTILISER ? (
              values.farmingSystem === 'Økologisk' ? (
                // Not registered: a disabled registered input would drop its value.
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked disabled readOnly />
                  <span>
                    Kun organisk gødning (ingen handelsgødnings-optopning)
                    <span className="block">
                      Følger driftsform: økologisk tilføres aldrig handelsgødning.
                    </span>
                  </span>
                </label>
              ) : (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" {...register('onlyOrganic')} />
                  Kun organisk gødning (ingen handelsgødnings-optopning)
                </label>
              )
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>N-norm%</Label>
            <p className="text-xs text-muted-foreground">
              Hvor stor en andel af den fulde N-norm der skal indgå - vælg et
              eller flere niveauer.
            </p>
            <div className="flex flex-wrap gap-2">
              {nNormOptions.map((value) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
                    values.nNormPercentages.includes(value)
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'bg-background hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={values.nNormPercentages.includes(value)}
                    onChange={() =>
                      updateValue(
                        'nNormPercentages',
                        toggleValue(getValues('nNormPercentages'), value),
                      )
                    }
                  />
                  {value}%
                </label>
              ))}
            </div>
            <FieldError
              id="scenario-n-norm-error"
              message={errors.nNormPercentages?.message}
            />
          </div>
        </div>
      ) : null}

      {!referenceBlocked && stepIndex === 3 ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>Efterafgrøde-etablering</Label>
            <p className="text-xs text-muted-foreground">
              Sådato/etableringsinterval for efterafgrøde (EEA) - gælder for
              alle år med efterafgrøde på tværs af simuleringens marker.
            </p>
            <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                {...register('catchCropDailyBasis')}
              />
              <span>
                <span className="font-medium">
                  Etableret med præcisionsteknologi (§38 - dagsbasis-effekt)
                </span>
                <span className="block text-xs text-muted-foreground">
                  Kun hvis udstyr med autostyring udfører positions- og
                  datobestemt såning. Ellers bruges standard-trappesatserne fra
                  §37.
                </span>
              </span>
            </label>

            {values.catchCropDailyBasis ? (
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                {...register('catchCropSowingDate')}
              >
                {SOWING_DATE_OPTIONS.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                {...register('catchCropSowingInterval')}
              >
                {SOWING_DATE_INTERVALS.map((interval) => (
                  <option key={interval.date} value={interval.date}>
                    {interval.label}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-muted-foreground">
              NUAR EEA-effekt:{' '}
              {sowingDateEffectPercent(
                catchCropSowingDate,
                values.catchCropDailyBasis,
              ).toFixed(1)}
              % ({values.catchCropDailyBasis ? 'dagsbasis, §38' : 'trappesats, §37'})
            </p>
          </div>

          <div className="space-y-2">
            <Label>Præcisionsjordbrug</Label>
            <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                {...register('precisionFarming')}
              />
              <span>
                <span className="font-medium">Anvend præcisionsjordbrug</span>
                <span className="block text-xs text-muted-foreground">
                  4 % ekstra reduktion af udvaskningen og 50 kr./ha i
                  omkostning. Gælder kun år med korn eller raps som
                  hovedafgrøde.
                </span>
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <Label>Tidlig såning og mellemafgrøde</Label>
            <p className="text-xs text-muted-foreground">
              Slået til som udgangspunkt. Når en mulighed slås fra, fjernes kun
              den udlægstype fra rotationerne. Efterafgrøder påvirkes ikke.
            </p>
            <label className="flex items-center gap-3 rounded-md border bg-background p-3 text-sm">
              <input type="checkbox" {...register('earlySowing')} />
              <span className="font-medium">Tillad tidlig såning</span>
            </label>
            <label className="flex items-center gap-3 rounded-md border bg-background p-3 text-sm">
              <input type="checkbox" {...register('intermediateCrop')} />
              <span className="font-medium">Tillad mellemafgrøde</span>
            </label>
          </div>
        </div>
      ) : null}

      {!referenceBlocked && stepIndex === 4 ? (
        <SimulationSummary
          values={values}
          categories={categories}
          fertiliserPresets={fertiliserPresets}
          fieldCount={fields.length}
          onEditStep={(index) => void goToStep(index)}
        />
      ) : null}
    </StepDialog>
  )
}
