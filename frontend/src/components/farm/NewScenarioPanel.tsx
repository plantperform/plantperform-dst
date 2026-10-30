import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { mutate } from 'swr'

import {
  simulationsKey,
  simulationViewKey,
  useFarmFields,
  useStoredSimulationFields,
  useFertiliserPresets,
  useRotationCategories,
  useRotationNNormPercentages,
} from '@/api/hooks'
import { createSimulation, updateSimulation } from '@/api/mutations'
import {
  useOptimizationRun,
  useOptimizationRunActions,
} from '@/api/optimization-runs'
import { ApiError } from '@/api/client'
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  DEFAULT_SIMULATION_CONSTRAINTS,
  optimizationSettingsInput,
  simulationLimitsError,
} from '@/lib/simulation-settings'
import { SimulationOptimizationOptions } from '@/components/farm/SimulationOptimizationOptions'
import { SimulationQuotaChoice } from '@/components/farm/SimulationQuotaChoice'
import { SimulationQuotaTradeOptions } from '@/components/farm/SimulationQuotaTradeOptions'
import {
  quotaTradeDraftFrom,
  quotaTradeError,
  quotaTradesFrom,
} from '@/lib/quota-trade-settings'
import { syncYearlyNLoadCaps } from '@/components/farm/catchment-options'
import type {
  FieldRecord,
  FertiliserSettings,
  RotationCategoryOption,
  Simulation,
} from '@/api/types'
import { GlossaryInfo } from '@/components/GlossaryInfo'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { CropChoicePicker } from '@/components/farm/CropChoicePicker'
import { LoadingSkeleton } from '@/components/farm/LoadingSkeleton'
import { RotationPicker } from '@/components/farm/RotationPicker'
import { SimulationSummary } from '@/components/farm/SimulationSummary'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { StepDialog, type StepDialogStep } from '@/components/ui/step-dialog'
import { STANDARD_PROFILE } from '@/lib/economics-profiles'
import { formatNumber, formatWholeNumber } from '@/lib/field-domain'
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
  capsOrganicFertiliserN,
  catchCropSowingDateOf,
  chosenCropsFor,
  fertiliserFieldsForChoice,
  isNNormOptionLocked,
  isPresetModified,
  isStepValid,
  offersNoFertiliser,
  organicFertiliserChoice,
  simulationFormSchema,
  simulationToFormValues,
  stepFields,
  stepIndexOf,
  toCreateSimulationInput,
  toggleNNormPercentage,
  withCropChoice,
  withFarmingSystem,
  type CropChoice,
  type RotationChoice,
  type SimulationFormValues,
} from '@/lib/simulation-form'
import {
  creationRequestIdentity,
  type CreationRequestIdentity,
} from '@/lib/simulation-creation'
import { cn } from '@/lib/utils'

type NewScenarioPanelProps = {
  farmId: string
  fields: FieldRecord[]
  source: Simulation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSimulationCreated: (simulation: Simulation) => void
  onError: (message: string | null) => void
}

const LAST_STEP_INDEX = SIMULATION_FORM_STEPS.length - 1
const LIMITS_STEP_INDEX = stepIndexOf('limits')
const QUOTA_TRADE_STEP_INDEX = stepIndexOf('quotaTrade')

const NO_CATEGORIES: RotationCategoryOption[] = []

const FERTILISER_FIELDS: (keyof SimulationFormValues)[] = [
  'fertiliserChoice',
  'orgMineralN',
  'mineralSharePct',
  'nContentKgPerTon',
]

export const NewScenarioPanel = ({
  farmId,
  fields,
  source,
  open,
  onOpenChange,
  onSimulationCreated,
  onError,
}: NewScenarioPanelProps) => {
  const farmFields = useFarmFields(farmId)
  const needsStoredFields =
    source !== null && source.fieldsInitialized !== false && fields.length === 0
  const usesFarmFields = source === null || source.fieldsInitialized === false
  const storedFields = useStoredSimulationFields(
    open && needsStoredFields ? farmId : undefined,
    source?.id,
    source?.revision,
  )
  const fieldsLoading = needsStoredFields
    ? storedFields.isLoading || storedFields.isValidating
    : usesFarmFields
      ? farmFields.isLoading
      : false
  const fieldsError = needsStoredFields
    ? storedFields.error
    : usesFarmFields
      ? farmFields.error
      : undefined
  const effectiveFields = usesFarmFields
    ? (farmFields.data ?? fields)
    : needsStoredFields
      ? (storedFields.data ?? [])
      : fields
  const { startRun } = useOptimizationRunActions()
  const run = useOptimizationRun(source?.id)
  const running =
    run?.status === 'running' ||
    source?.result.status === 'queued' ||
    source?.result.status === 'in_progress'
  const [optimizationSettings, setOptimizationSettings] = useState(
    optimizationSettingsInput(
      source?.optimizationSettings ?? DEFAULT_OPTIMIZATION_SETTINGS,
    ),
  )
  const [constraints, setConstraints] = useState(
    source?.constraints ?? DEFAULT_SIMULATION_CONSTRAINTS,
  )
  const [quotaTradeDraft, setQuotaTradeDraft] = useState(
    quotaTradeDraftFrom(source?.optimizationSettings?.quotaTrades),
  )
  const savedSimulation = useRef<Simulation | null>(null)
  const categoriesQuery = useRotationCategories(farmId)
  const nNormQuery = useRotationNNormPercentages(farmId)
  const presetsQuery = useFertiliserPresets(farmId)
  const economicsProfiles = useEconomicsProfiles()
  const categories = categoriesQuery.data ?? NO_CATEGORIES
  const nNormOptions = nNormQuery.data ?? []
  const fertiliserPresets = presetsQuery.data ?? []
  const referenceQueries = [categoriesQuery, nNormQuery, presetsQuery]
  const referenceLoading = referenceQueries.some((query) => query.isLoading)
  const referenceError = referenceQueries.some((query) => query.error)
  const referenceRetrying = referenceQueries.some((query) => query.isValidating)
  // Steps after the first need the reference data, so hide them until it is in.
  const referenceBlocked = referenceLoading || referenceError
  const stepReachable = (index: number) =>
    index <= stepIndexOf('crops') || !referenceBlocked
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
  const economicsProfile =
    economicsProfiles.findProfile(values.economicsProfileId) ?? STANDARD_PROFILE

  const [stepIndex, setStepIndex] = useState(0)
  const [furthestStepIndex, setFurthestStepIndex] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [limitsTouched, setLimitsTouched] = useState(false)
  const [quotaTradeTouched, setQuotaTradeTouched] = useState(false)
  const creationRequest = useRef<CreationRequestIdentity | null>(null)

  const hasFields = effectiveFields.length > 0

  // Saving the grænser under Regler does not change the revision, so the
  // constraints are part of the key: reopening after such a save starts from
  // the saved grænser instead of the ones the panel held before.
  const prefillKey = !open
    ? null
    : source === null
      ? 'blank'
      : `${source.id}:${source.revision}:${source.name}:${JSON.stringify(source.constraints)}`
  const [prefilled, setPrefilled] = useState<{
    key: string
    values: SimulationFormValues | null
    simulation?: Simulation | null
  }>({ key: 'blank', values: null })
  if (prefillKey !== null && prefillKey !== prefilled.key) {
    setOptimizationSettings(
      optimizationSettingsInput(
        source?.optimizationSettings ?? DEFAULT_OPTIMIZATION_SETTINGS,
      ),
    )
    setConstraints(source?.constraints ?? DEFAULT_SIMULATION_CONSTRAINTS)
    setQuotaTradeDraft(
      quotaTradeDraftFrom(source?.optimizationSettings?.quotaTrades),
    )
    setPrefilled({
      key: prefillKey,
      simulation: source,
      values: source
        ? {
            ...simulationToFormValues(source, fertiliserPresets, nNormOptions),
            name: source.name,
            nNormPercentages: source.nNormPercentages,
            economicsProfileId:
              economicsProfiles.profileForSimulation(source).id,
            chosenCrops: chosenCropsFor(categories, {
              rotationVariants: source.rotationVariants,
              farmingSystem: source.fertiliser.farmingSystem,
            }),
          }
        : DEFAULT_SIMULATION_FORM_VALUES,
    })
    setStepIndex(0)
    setFurthestStepIndex(source ? LAST_STEP_INDEX : 0)
    setCreateError(null)
    setLimitsTouched(false)
    setQuotaTradeTouched(false)
  }
  // Once per opening, after fields load: a yearly cap that is the same in
  // every year follows the maks. udledning under Regler. Later edits in the
  // panel keep the two in step themselves.
  const [yearlySyncedKey, setYearlySyncedKey] = useState<string | null>(null)
  if (
    open &&
    prefillKey === prefilled.key &&
    yearlySyncedKey !== prefillKey &&
    !fieldsLoading &&
    !fieldsError &&
    optimizationSettings.kind === 'yearly'
  ) {
    setYearlySyncedKey(prefillKey)
    const synced = syncYearlyNLoadCaps(
      optimizationSettings,
      effectiveFields,
      constraints.maxNLoadByCatchment,
    )
    if (synced !== optimizationSettings) setOptimizationSettings(synced)
  }
  const limitsError = simulationLimitsError(optimizationSettings, constraints)
  const quotaTradeStepError = quotaTradeError(
    quotaTradeDraft,
    optimizationSettings,
    effectiveFields,
  )
  // What is saved and summarised: the draft becomes the settings' trades here.
  const settingsWithTrades = {
    ...optimizationSettings,
    quotaTrades: quotaTradesFrom(
      quotaTradeDraft,
      optimizationSettings,
      effectiveFields,
    ),
  }
  useEffect(() => {
    if (prefilled.values) {
      reset(prefilled.values)
      savedSimulation.current = prefilled.simulation ?? null
    }
  }, [prefilled, reset])
  const missingCrops =
    categories.length > 0 &&
    values.chosenCrops.length === 0 &&
    values.rotationVariants.length > 0
  useEffect(() => {
    if (missingCrops) {
      setValue('chosenCrops', chosenCropsFor(categories, getValues()))
    }
  }, [missingCrops, categories, getValues, setValue])

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
    if (index === LIMITS_STEP_INDEX) {
      setLimitsTouched(true)
      return limitsError === null
    }
    if (index === QUOTA_TRADE_STEP_INDEX) {
      setQuotaTradeTouched(true)
      return quotaTradeStepError === null
    }
    const names = stepFields(index)
    if (names.length === 0) return true
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
    creationRequest.current = null
    savedSimulation.current = source
    setOptimizationSettings(
      optimizationSettingsInput(
        source?.optimizationSettings ?? DEFAULT_OPTIMIZATION_SETTINGS,
      ),
    )
    setConstraints(source?.constraints ?? DEFAULT_SIMULATION_CONSTRAINTS)
    setQuotaTradeDraft(
      quotaTradeDraftFrom(source?.optimizationSettings?.quotaTrades),
    )
    reset(DEFAULT_SIMULATION_FORM_VALUES)
    setStepIndex(0)
    setFurthestStepIndex(0)
    setCreateError(null)
    setLimitsTouched(false)
    setYearlySyncedKey(null)
    setQuotaTradeTouched(false)
    setPrefilled({ key: 'blank', values: null })
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
    if (FERTILISER_FIELDS.some((name) => errors[name])) {
      void trigger(FERTILISER_FIELDS)
    }
  }

  const cropChoice: CropChoice = {
    chosenCrops: values.chosenCrops,
    optedOutCrops: values.optedOutCrops,
  }
  const applyRotationChoice = (next: RotationChoice) => {
    updateValue('chosenCrops', next.chosenCrops)
    updateValue('optedOutCrops', next.optedOutCrops)
    updateValue('rotationVariants', next.rotationVariants)
  }

  const catchCropSowingDate = catchCropSowingDateOf(values)
  const presetModified = isPresetModified(values, fertiliserPresets)

  const saveSimulation = async () => {
    const existing = savedSimulation.current ?? source
    const economicsModuleId = getValues().economicsProfileId
    const input = {
      ...toCreateSimulationInput(getValues()),
      constraints,
      optimizationSettings: optimizationSettingsInput(settingsWithTrades),
      ...(existing &&
      economicsProfiles.profileForSimulation(existing).id === economicsModuleId
        ? {}
        : { economicsModuleId }),
    }
    return existing
      ? updateSimulation(
          farmId,
          existing.id,
          running
            ? {
                expectedRevision: existing.revision,
                name: getValues('name').trim(),
              }
            : { ...input, expectedRevision: existing.revision },
        )
      : createSimulation(farmId, {
          ...input,
          requestId: (creationRequest.current = creationRequestIdentity(
            input,
            creationRequest.current,
          )).requestId,
        })
  }

  const startOptimization = async (simulation: Simulation) => {
    const current = await economicsProfiles.withCurrentEconomics(simulation)
    if (current === null) return 'stopped'
    const settings = current.optimizationSettings ?? settingsWithTrades
    const common = {
      farmId,
      simulationId: current.id,
      fieldsBefore: effectiveFields,
      input: {
        ...optimizationSettingsInput(settings),
        expectedRevision: current.revision,
      },
    }
    const started = startRun(
      settings.kind === 'yearly'
        ? { ...common, kind: 'yearly' }
        : { ...common, kind: 'optimize' },
    )
    return started === null ? 'alreadyRunning' : 'started'
  }

  const createScenario = async (optimize = false) => {
    if (optimize && (!hasFields || fieldsLoading || fieldsError)) return
    if (running) {
      if (!(await trigger('name'))) return
    } else
      for (let index = 0; index <= LAST_STEP_INDEX; index += 1) {
        if (!(await validateStep(index))) {
          setStepIndex(index)
          return
        }
      }

    setIsCreating(true)
    setCreateError(null)
    try {
      const simulation = await saveSimulation()
      savedSimulation.current = simulation
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) => [
          ...current.filter((item) => item.id !== simulation.id),
          simulation,
        ],
        { revalidate: false },
      )
      void mutate(simulationViewKey(farmId, simulation.id))
      onSimulationCreated(simulation)
      let outcome: Awaited<ReturnType<typeof startOptimization>> = 'started'
      if (optimize) outcome = await startOptimization(simulation)
      if (outcome === 'alreadyRunning') {
        setCreateError('Simuleringen har allerede en aktiv optimering.')
      } else if (outcome === 'started') {
        onError(null)
        onOpenChange(false)
        creationRequest.current = null
      }
    } catch (error) {
      setCreateError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : 'Kunne ikke gemme simuleringen. Prøv igen.',
      )
    }
    setIsCreating(false)
    void mutate(simulationsKey(farmId))
  }

  const steps: StepDialogStep[] = SIMULATION_FORM_STEPS.map((step, index) => ({
    id: step.id,
    label: step.label,
    status:
      index > furthestStepIndex
        ? 'upcoming'
        : (
              index === LIMITS_STEP_INDEX
                ? limitsError === null
                : index === QUOTA_TRADE_STEP_INDEX
                  ? quotaTradeStepError === null
                  : isStepValid(index, values)
            )
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
    <p className="text-muted-foreground">Gemmer indstillinger...</p>
  ) : null

  const stepId = SIMULATION_FORM_STEPS[stepIndex].id
  const isLastStep = stepIndex === LAST_STEP_INDEX

  return (
    <StepDialog
      open={open}
      onOpenChange={onOpenChange}
      title={source ? 'Simuleringens indstillinger' : 'Ny simulering'}
      description={
        source
          ? `Ret indstillingerne for ${source.name} og kør optimeringen igen.`
          : `Simuleringen oprettes med de ${effectiveFields.length} ${
              effectiveFields.length === 1 ? 'mark' : 'marker'
            }, der er valgt under Afgrødehistorik.`
      }
      steps={steps}
      currentIndex={stepIndex}
      onStepSelect={(index) => {
        if (stepReachable(index)) void goToStep(index)
      }}
      locked={isCreating}
      footerMessage={footerMessage}
      secondaryAction={
        running ? (
          <Button
            variant="outline"
            onClick={() => void createScenario(false)}
            loading={isCreating}
          >
            Gem navn
          </Button>
        ) : stepIndex === 0 &&
          (isDirty ||
            JSON.stringify(optimizationSettings) !==
              JSON.stringify(
                optimizationSettingsInput(
                  source?.optimizationSettings ?? DEFAULT_OPTIMIZATION_SETTINGS,
                ),
              ) ||
            JSON.stringify(constraints) !==
              JSON.stringify(
                source?.constraints ?? DEFAULT_SIMULATION_CONSTRAINTS,
              ) ||
            JSON.stringify(quotaTradeDraft) !==
              JSON.stringify(
                quotaTradeDraftFrom(source?.optimizationSettings?.quotaTrades),
              )) ? (
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
            <>
              <Button
                variant="outline"
                onClick={() => void createScenario(false)}
                disabled={referenceBlocked}
                loading={isCreating}
              >
                Gem
              </Button>
              <Button
                onClick={() => void createScenario(true)}
                disabled={
                  !hasFields ||
                  fieldsLoading ||
                  Boolean(fieldsError) ||
                  referenceBlocked ||
                  running
                }
                loading={isCreating}
              >
                Kør optimering
              </Button>
            </>
          ) : (
            <Button
              onClick={() => void goToStep(stepIndex + 1)}
              disabled={!stepReachable(stepIndex + 1)}
            >
              Næste
            </Button>
          )}
        </>
      }
    >
      {fieldsError ? (
        <LoadError
          message="Kunne ikke hente simuleringens marker."
          onRetry={() =>
            void (needsStoredFields
              ? storedFields.mutate()
              : farmFields.mutate())
          }
          retrying={fieldsLoading}
        />
      ) : fieldsLoading ? (
        <LoadingSkeleton message="Henter simuleringens marker..." />
      ) : null}
      {stepId === 'basics' ? (
        <div className="space-y-6">
          {!hasFields && !fieldsLoading && !fieldsError ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong">
              Vælg mindst én mark under Afgrødehistorik, før du kører
              optimeringen. Du kan stadig gemme indstillingerne.
            </p>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Gem indstillingerne eller kør optimeringen for at vælge det bedste
            sædskifte pr. mark.
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
            <FieldError
              id="scenario-name-error"
              message={errors.name?.message}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scenario-farming-system">Driftsform</Label>
            <select
              id="scenario-farming-system"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              disabled={running}
              {...register('farmingSystem', {
                onChange: (event) => {
                  const value = event.target
                    .value as FertiliserSettings['farmingSystem']
                  setValue('onlyOrganic', value === 'Økologisk')
                  applyRotationChoice(
                    withFarmingSystem(categories, getValues(), value),
                  )
                  if (
                    !offersNoFertiliser(value) &&
                    getValues('fertiliserChoice') === NO_FERTILISER
                  ) {
                    applyFertiliserChoice(
                      organicFertiliserChoice(fertiliserPresets),
                    )
                  }
                },
              })}
            >
              <option value="Konventionel">Konventionel</option>
              <option value="Økologisk">Økologisk</option>
            </select>
          </div>
          <SimulationQuotaChoice
            kind={optimizationSettings.kind}
            disabled={running || isCreating}
            onChange={(kind) => {
              setOptimizationSettings((current) => ({ ...current, kind }))
              setYearlySyncedKey(null)
            }}
          />

          <div className="space-y-2">
            <Label htmlFor="scenario-economics-profile">Økonomiprofil</Label>
            <select
              id="scenario-economics-profile"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              disabled={running || isCreating}
              {...register('economicsProfileId')}
            >
              {economicsProfiles.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Priser og mængder bag dækningsbidraget. Profilen kan skiftes
              senere under Regler.
            </p>
          </div>
        </div>
      ) : null}

      {running ? (
        <p className="text-sm text-muted-foreground">
          Optimeringen er i gang. Du kan stadig ændre navnet.
        </p>
      ) : null}
      <fieldset disabled={running || isCreating} className="min-w-0 space-y-4">
        {stepIndex > 0 && referenceError ? (
          <LoadError
            message="Kunne ikke hente sædskifter, N-norm-niveauer og gødningstyper."
            onRetry={retryReferenceData}
            retrying={referenceRetrying}
          />
        ) : stepIndex > 0 && referenceLoading ? (
          <LoadingSkeleton message="Henter sædskifter og gødningstyper..." />
        ) : null}

        {!referenceBlocked && stepId === 'crops' ? (
          <CropChoicePicker
            categories={categories}
            farmingSystem={values.farmingSystem}
            choice={cropChoice}
            onChoiceChange={(choice) =>
              applyRotationChoice(
                withCropChoice(categories, {
                  ...choice,
                  rotationVariants: getValues('rotationVariants'),
                }),
              )
            }
            error={errors.chosenCrops?.message}
          />
        ) : null}

        {!referenceBlocked && stepId === 'rotations' ? (
          <RotationPicker
            categories={categories}
            farmingSystem={values.farmingSystem}
            cropChoice={cropChoice}
            rotationVariants={values.rotationVariants}
            onRotationVariantsChange={(next) =>
              updateValue('rotationVariants', next)
            }
            error={errors.rotationVariants?.message}
          />
        ) : null}

        {!referenceBlocked && stepId === 'nitrogen' ? (
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
                aria-invalid={Boolean(errors.fertiliserChoice)}
                aria-describedby={
                  errors.fertiliserChoice
                    ? 'scenario-fertiliser-choice-error'
                    : undefined
                }
                className="grid gap-2 sm:grid-cols-2"
              >
                {[
                  ...(offersNoFertiliser(values.farmingSystem)
                    ? [
                        {
                          value: NO_FERTILISER,
                          label: 'Ingen organisk gødning',
                          detail: 'Ren handelsgødning',
                        },
                      ]
                    : []),
                  ...fertiliserPresets.map((preset) => ({
                    value: preset.name,
                    label: preset.name,
                    detail: capsOrganicFertiliserN(values.farmingSystem)
                      ? `${formatNumber(preset.fertiliser.orgMineralN)} kg N/ha · ${formatNumber(preset.fertiliser.mineralSharePct)} % mineralsk`
                      : `${formatNumber(preset.fertiliser.mineralSharePct)} % mineralsk`,
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
              <FieldError
                id="scenario-fertiliser-choice-error"
                message={errors.fertiliserChoice?.message}
              />

              {presetModified ? (
                <p className="text-xs text-muted-foreground">
                  Værdierne afviger fra standarden for {values.fertiliserChoice}
                  .{' '}
                  <button
                    type="button"
                    className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      applyFertiliserChoice(values.fertiliserChoice)
                    }
                  >
                    Gendan standard
                  </button>
                </p>
              ) : null}

              {values.fertiliserChoice !== NO_FERTILISER ? (
                <div className="grid items-start gap-3 sm:grid-cols-2">
                  {capsOrganicFertiliserN(values.farmingSystem) ? (
                    <label className="space-y-1 text-sm sm:col-span-2">
                      <span className="text-xs text-muted-foreground">
                        Maks tilladt mineralsk N fra organisk gødning (kg N/ha)
                      </span>
                      <Input
                        type="number"
                        min="0"
                        aria-invalid={Boolean(errors.orgMineralN)}
                        aria-describedby={
                          errors.orgMineralN
                            ? 'scenario-org-n-error'
                            : 'scenario-org-n-help'
                        }
                        {...register('orgMineralN')}
                      />
                      <FieldError
                        id="scenario-org-n-error"
                        message={errors.orgMineralN?.message}
                      />
                      <span
                        id="scenario-org-n-help"
                        className="block text-xs text-muted-foreground"
                      >
                        {(() => {
                          const mineralN = Number(values.orgMineralN)
                          const mineralPct = Number(values.mineralSharePct)
                          if (!mineralN || !mineralPct) return null
                          return (
                            <>
                              Med {formatNumber(mineralPct)} % mineralsk andel
                              svarer det til ca.{' '}
                              {formatWholeNumber(mineralN / (mineralPct / 100))}{' '}
                              kg total-N/ha.
                            </>
                          )
                        })()}
                      </span>
                    </label>
                  ) : (
                    <p className="text-sm sm:col-span-2">
                      Ved økologisk driftsform dækker husdyrgødningen hele
                      N-normen.
                    </p>
                  )}
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
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      Mineralsk N-indhold (kg N/ton)
                      <GlossaryInfo term="nContentPerTon" />
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
                      {(() => {
                        const utilisedPerTon = Number(values.nContentKgPerTon)
                        const mineralPct = Number(values.mineralSharePct)
                        if (!utilisedPerTon || !mineralPct) return null
                        const totalPerTon = utilisedPerTon / (mineralPct / 100)
                        return (
                          <>
                            Med {formatNumber(mineralPct)} % mineralsk andel
                            indeholder et ton ca. {formatNumber(totalPerTon)} kg
                            total-N.
                          </>
                        )
                      })()}
                    </span>
                  </label>
                </div>
              ) : null}

              {/* Økologisk is always only organic (toCreateSimulationInput
                  forces it), so the choice is shown for konventionel only. */}
              {values.fertiliserChoice !== NO_FERTILISER &&
              values.farmingSystem !== 'Økologisk' ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" {...register('onlyOrganic')} />
                  Kun organisk gødning (ingen handelsgødnings-optopning)
                </label>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label>N-norm%</Label>
                <GlossaryInfo term="nNormLevel" />
              </div>
              <p className="text-xs text-muted-foreground">
                100 % er altid med. Vælg op til to lavere niveauer.
              </p>
              <div className="flex flex-wrap gap-2">
                {nNormOptions.map((value) => {
                  const checked = values.nNormPercentages.includes(value)
                  const locked = isNNormOptionLocked(
                    values.nNormPercentages,
                    value,
                  )
                  return (
                    <label
                      key={value}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition-colors',
                        checked
                          ? 'border-primary bg-primary/10 font-medium'
                          : 'bg-background',
                        locked
                          ? checked
                            ? 'cursor-default'
                            : 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer hover:bg-muted/50',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        disabled={locked}
                        onChange={() =>
                          updateValue(
                            'nNormPercentages',
                            toggleNNormPercentage(
                              getValues('nNormPercentages'),
                              value,
                            ),
                          )
                        }
                      />
                      {value}%
                    </label>
                  )
                })}
              </div>
              <FieldError
                id="scenario-n-norm-error"
                message={errors.nNormPercentages?.message}
              />
            </div>

            <div className="space-y-2">
              <Label>Forfrugtsværdi</Label>
              <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  {...register('includePrecedingCropValue')}
                />
                <span>
                  <span className="font-medium">Regn forfrugtsværdien med</span>
                  <span className="block text-xs text-muted-foreground">
                    Forfrugtsværdien trækkes fra næste afgrødes kvælstofnorm.
                  </span>
                  <span className="block text-xs text-warning-strong">
                    Valget indgår ikke i beregningen endnu.
                  </span>
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {!referenceBlocked && stepId === 'practice' ? (
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
                    datobestemt såning. Ellers bruges standard-trappesatserne
                    fra §37.
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
                % (
                {values.catchCropDailyBasis
                  ? 'dagsbasis, §38'
                  : 'trappesats, §37'}
                )
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
                    4 % ekstra reduktion af udvaskningen og 50 kr/ha i
                    omkostning. Gælder kun år med korn eller raps som
                    hovedafgrøde.
                  </span>
                </span>
              </label>
            </div>

            <div className="space-y-2">
              <Label>Tidlig såning og mellemafgrøde</Label>
              <p className="text-xs text-muted-foreground">
                Slået til som udgangspunkt. Når en mulighed slås fra, fjernes
                kun den udlægstype fra rotationerne. Efterafgrøder påvirkes
                ikke.
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

        {!referenceBlocked && stepId === 'limits' ? (
          <div className="space-y-4">
            <FieldError
              id="simulation-limits-error"
              message={limitsTouched ? limitsError : null}
            />
            <SimulationOptimizationOptions
              farmId={farmId}
              fields={effectiveFields}
              variants={values.rotationVariants}
              settings={optimizationSettings}
              constraints={constraints}
              onSettingsChange={setOptimizationSettings}
              onConstraintsChange={setConstraints}
            />
          </div>
        ) : null}
        {!referenceBlocked && stepId === 'quotaTrade' ? (
          <div className="space-y-4">
            <FieldError
              id="simulation-quota-trade-error"
              message={quotaTradeTouched ? quotaTradeStepError : null}
            />
            <SimulationQuotaTradeOptions
              farmId={farmId}
              fields={effectiveFields}
              settings={optimizationSettings}
              draft={quotaTradeDraft}
              onDraftChange={setQuotaTradeDraft}
            />
          </div>
        ) : null}
        {!referenceBlocked && stepId === 'confirm' ? (
          <SimulationSummary
            farmId={farmId}
            fields={effectiveFields}
            values={values}
            categories={categories}
            fertiliserPresets={fertiliserPresets}
            settings={settingsWithTrades}
            constraints={constraints}
            economicsProfile={economicsProfile}
            onEditStep={(index) => void goToStep(index)}
          />
        ) : null}
      </fieldset>
    </StepDialog>
  )
}
