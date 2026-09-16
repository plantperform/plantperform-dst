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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SOWING_DATE_OPTIONS,
  SOWING_DATE_INTERVALS,
  sowingDateEffectPercent,
} from '@/lib/nles5-detail-labels'
import {
  DEFAULT_SIMULATION_FORM_VALUES,
  NO_FERTILISER,
  catchCropSowingDateOf,
  fertiliserFieldsForChoice,
  selectedInCategory,
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

  const { register, control, setValue, getValues, reset } =
    useForm<SimulationFormValues>({
      defaultValues: DEFAULT_SIMULATION_FORM_VALUES,
    })
  const values = useWatch({ control }) as SimulationFormValues

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  )
  const [isCreating, setIsCreating] = useState(false)

  const applyFertiliserChoice = (choice: string) => {
    setValue('fertiliserChoice', choice)
    const fertiliserFields = fertiliserFieldsForChoice(
      choice,
      fertiliserPresets,
      getValues('farmingSystem'),
    )
    if (!fertiliserFields) return
    setValue('orgMineralN', fertiliserFields.orgMineralN)
    setValue('mineralSharePct', fertiliserFields.mineralSharePct)
    setValue('onlyOrganic', fertiliserFields.onlyOrganic)
  }

  const catchCropSowingDate = catchCropSowingDateOf(values)

  const toggleRotation = (rotationVariant: string) =>
    setValue(
      'rotationVariants',
      toggleValue(getValues('rotationVariants'), rotationVariant),
    )

  const toggleExpanded = (category: string) =>
    setExpandedCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })

  const canCreate =
    values.name.trim() !== '' &&
    values.rotationVariants.length > 0 &&
    values.nNormPercentages.length > 0 &&
    fields.length > 0

  const createScenario = async () => {
    const formValues = getValues()
    if (!formValues.name.trim()) {
      onError('Indtast et navn til simuleringen.')
      return
    }
    if (formValues.rotationVariants.length === 0) {
      onError('Vælg mindst et sædskifte i mindst en kategori.')
      return
    }
    if (formValues.nNormPercentages.length === 0) {
      onError('Vælg mindst en N-norm%.')
      return
    }

    setIsCreating(true)
    try {
      const simulation = await createSimulation(
        farmId,
        toCreateSimulationInput(formValues),
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
      reset(DEFAULT_SIMULATION_FORM_VALUES)
      setExpandedCategories(new Set())
    } catch {
      onError('Kunne ikke oprette simuleringen.')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ny simulering</DialogTitle>
          <DialogDescription>
            Simuleringen oprettes med de {fields.length}{' '}
            {fields.length === 1 ? 'mark, der er valgt' : 'marker, der er valgt'} under Afgrødehistorik.
            Alle sædskifte-kandidater der matcher dine valg beregnes og gøres klar i baggrunden -
            du bruger derefter Optimér til at vælge det bedste sædskifte pr. mark.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="scenario-name">Simuleringens navn</Label>
            <Input
              id="scenario-name"
              placeholder="Reduceret kvælstof"
              {...register('name')}
            />
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

          <div className="space-y-2">
            <Label>Sædskifter</Label>
            <p className="text-xs text-muted-foreground">
              Grupperet efter sædskifte-type til overblik - gødning vælges separat
              nedenfor og er uafhængig af hvilke sædskifter du vælger her. Fold en
              gruppe ud for at vælge specifikke sædskifter til/fra - ellers indgår alle.
            </p>
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
                        checked={allSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = partiallySelected
                        }}
                        onChange={() =>
                          setValue(
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
                                toggleRotation(rotation.rotationVariant)
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

          <div className="space-y-3">
            <Label>Gødning</Label>
            <p className="text-xs text-muted-foreground">
              Uafhængig af hvilke sædskifter du har valgt ovenfor - samme
              gødningsvalg bruges for alle valgte sædskifter i simuleringen.
            </p>
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Gødningstype</span>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={values.fertiliserChoice}
                onChange={(event) =>
                  applyFertiliserChoice(event.target.value)
                }
              >
                <option value="none">Ingen organisk gødning (ren handelsgødning)</option>
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
                    {...register('orgMineralN')}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">Mineralsk andel (%)</span>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    {...register('mineralSharePct')}
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
                    {...register('nContentKgPerTon')}
                  />
                  <span className="block text-xs text-muted-foreground">
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
                <input
                  type="checkbox"
                  {...register('onlyOrganic')}
                />
                Kun organisk gødning (ingen handelsgødnings-optopning) - typisk økologisk
              </label>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>N-norm%</Label>
            <p className="text-xs text-muted-foreground">
              Hvor stor en andel af den fulde N-norm der skal indgå - vælg et eller flere niveauer.
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
                      setValue(
                        'nNormPercentages',
                        toggleValue(getValues('nNormPercentages'), value),
                      )
                    }
                  />
                  {value}%
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Efterafgrøde-etablering</Label>
            <p className="text-xs text-muted-foreground">
              Sådato/etableringsinterval for efterafgrøde (EEA) - gælder for alle år med
              efterafgrøde på tværs af simuleringens marker.
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
                  Kun hvis udstyr med autostyring udfører positions- og datobestemt såning.
                  Ellers bruges standard-trappesatserne fra §37.
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
              {sowingDateEffectPercent(catchCropSowingDate, values.catchCropDailyBasis).toFixed(1)}% (
              {values.catchCropDailyBasis ? 'dagsbasis, §38' : 'trappesats, §37'})
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
                  4 % ekstra reduktion af udvaskningen og 50 kr./ha i omkostning.
                  Gælder kun år med korn eller raps som hovedafgrøde.
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
              <input
                type="checkbox"
                {...register('earlySowing')}
              />
              <span className="font-medium">Tillad tidlig såning</span>
            </label>
            <label className="flex items-center gap-3 rounded-md border bg-background p-3 text-sm">
              <input
                type="checkbox"
                {...register('intermediateCrop')}
              />
              <span className="font-medium">Tillad mellemafgrøde</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => void createScenario()} disabled={!canCreate || isCreating}>
              {isCreating ? 'Opretter simulering...' : 'Opret simulering'}
            </Button>
            {isCreating ? (
              <p className="text-sm text-muted-foreground">
                Beregner sædskifte-kandidater for alle marker - kan tage et øjeblik.
              </p>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
