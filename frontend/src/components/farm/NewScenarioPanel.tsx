import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, ChevronRight } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StepDialog, type StepDialogStep } from '@/components/ui/step-dialog'
import {
  SOWING_DATE_OPTIONS,
  SOWING_DATE_INTERVALS,
  sowingDateEffectPercent,
} from '@/lib/nles5-detail-labels'
import {
  DEFAULT_SIMULATION_FORM_VALUES,
  NO_FERTILISER,
  SIMULATION_FORM_STEPS,
  catchCropSowingDateOf,
  fertiliserFieldsForChoice,
  isStepValid,
  selectedInCategory,
  simulationFormSchema,
  stepFields,
  toCreateSimulationInput,
  toggleCategoryRotations,
  toggleValue,
  type SimulationFormValues,
} from '@/lib/simulation-form'

type NewScenarioPanelProps = {
  farmId: string
  fields: FieldRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSimulationCreated: (simulation: Simulation) => void
  onError: (message: string | null) => void
}

const LAST_STEP_INDEX = SIMULATION_FORM_STEPS.length - 1

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  ) : null

export const NewScenarioPanel = ({
  farmId,
  fields,
  open,
  onOpenChange,
  onSimulationCreated,
  onError,
}: NewScenarioPanelProps) => {
  const { data: categories = [] } = useRotationCategories(farmId)
  const { data: nNormOptions = [] } = useRotationNNormPercentages(farmId)
  const { data: fertiliserPresets = [] } = useFertiliserPresets(farmId)

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
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  )
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
    setExpandedCategories(new Set())
    setCreateError(null)
  }

  const applyFertiliserChoice = (choice: string) => {
    updateValue('fertiliserChoice', choice)
    const fertiliserFields = fertiliserFieldsForChoice(
      choice,
      fertiliserPresets,
      getValues('farmingSystem'),
    )
    if (!fertiliserFields) return
    updateValue('orgMineralN', fertiliserFields.orgMineralN)
    updateValue('mineralSharePct', fertiliserFields.mineralSharePct)
    updateValue('onlyOrganic', fertiliserFields.onlyOrganic)
  }

  const catchCropSowingDate = catchCropSowingDateOf(values)

  const toggleExpanded = (category: string) =>
    setExpandedCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })

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
      onStepSelect={(index) => void goToStep(index)}
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
              disabled={!hasFields || isCreating}
            >
              {isCreating ? 'Opretter simulering...' : 'Opret simulering'}
            </Button>
          ) : (
            <Button
              onClick={() => void goToStep(stepIndex + 1)}
              disabled={!hasFields}
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

      {stepIndex === 1 ? (
        <div className="space-y-2">
          <Label>Sædskifter</Label>
          <p className="text-xs text-muted-foreground">
            Grupperet efter sædskifte-type til overblik - gødning vælges i
            næste trin og er uafhængig af hvilke sædskifter du vælger her. Fold
            en gruppe ud for at vælge specifikke sædskifter til/fra.
          </p>
          <FieldError
            id="scenario-rotations-error"
            message={errors.rotationVariants?.message}
          />
          <div className="space-y-1">
            {categories.map((option) => {
              const selectedCount = selectedInCategory(
                option,
                values.rotationVariants,
              )
              const allSelected =
                option.rotations.length > 0 &&
                selectedCount === option.rotations.length
              const partiallySelected = selectedCount > 0 && !allSelected
              const isExpanded = expandedCategories.has(option.category)
              return (
                <div
                  key={option.category}
                  className="rounded-md border bg-background"
                >
                  <div className="flex items-start gap-2 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Vælg alle i ${option.category}`}
                      checked={allSelected}
                      ref={(element) => {
                        if (element) element.indeterminate = partiallySelected
                      }}
                      onChange={() =>
                        updateValue(
                          'rotationVariants',
                          toggleCategoryRotations(
                            option,
                            getValues('rotationVariants'),
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="flex flex-1 items-start justify-between gap-2 text-left"
                      onClick={() => toggleExpanded(option.category)}
                    >
                      <span>
                        <span className="font-medium">{option.category}</span>
                        <span className="block text-xs text-muted-foreground">
                          {selectedCount}/{option.rotationCount} sædskifter
                          valgt
                        </span>
                      </span>
                      {isExpanded ? (
                        <ChevronDown
                          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronRight
                          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </div>
                  {isExpanded ? (
                    <div className="max-h-56 space-y-1 overflow-y-auto border-t p-2">
                      {option.rotations.map((rotation) => (
                        <label
                          key={rotation.rotationVariant}
                          className="flex items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={values.rotationVariants.includes(
                              rotation.rotationVariant,
                            )}
                            onChange={() =>
                              updateValue(
                                'rotationVariants',
                                toggleValue(
                                  getValues('rotationVariants'),
                                  rotation.rotationVariant,
                                ),
                              )
                            }
                          />
                          <span>{rotation.cropSequence.join(' - ')}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {stepIndex === 2 ? (
        <div className="space-y-6">
          <div className="space-y-3">
            <Label>Gødning</Label>
            <p className="text-xs text-muted-foreground">
              Uafhængig af hvilke sædskifter du har valgt - samme gødningsvalg
              bruges for alle valgte sædskifter i simuleringen.
            </p>
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Gødningstype</span>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={values.fertiliserChoice}
                onChange={(event) => applyFertiliserChoice(event.target.value)}
              >
                <option value="none">
                  Ingen organisk gødning (ren handelsgødning)
                </option>
                {fertiliserPresets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
                <option value="custom">Brugerdefineret</option>
              </select>
            </label>

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
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" {...register('onlyOrganic')} />
                Kun organisk gødning (ingen handelsgødnings-optopning) - typisk
                økologisk
              </label>
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

      {stepIndex === 3 ? (
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
    </StepDialog>
  )
}
