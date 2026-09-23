import { Info, SlidersHorizontal } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

import {
  useScenarioCropCodes,
  useYearlyOptimizationCandidates,
} from '@/api/hooks'
import type {
  CatchmentYearlyNLoadCaps,
  FieldRecord,
  Simulation,
} from '@/api/types'
import {
  catchmentKey,
  effectiveMaxNLoadByCatchment,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { OptimizationRunProgress } from '@/components/farm/OptimizationRunProgress'
import { useOptimizationDialogRun } from '@/components/farm/optimization-dialog-run'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { Spinner } from '@/components/ui/spinner'
import { StepDialog, type StepDialogStep } from '@/components/ui/step-dialog'
import { formatNumber, ROTATION_CALENDAR_YEARS } from '@/lib/field-domain'
import {
  OPTIMIZATION_KIND_LABELS,
  type OptimizationKind,
} from '@/lib/optimization-run'
import { cn } from '@/lib/utils'

const KIND_ORDER: OptimizationKind[] = ['optimize', 'yearly']

// What the quota applies to, and when to choose the kind.
const KIND_DESCRIPTIONS: Record<
  OptimizationKind,
  { appliesTo: string; chooseWhen: string }
> = {
  optimize: {
    appliesTo:
      'Kvoten gælder for gennemsnittet af simuleringens år. Et år må ligge over kvoten, når et andet ligger tilsvarende under.',
    chooseWhen:
      'Vælg den, når kvoten skal overholdes over hele perioden. Bruger de regler, der er gemt på simuleringen.',
  },
  yearly: {
    appliesTo:
      'Kvoten er et loft, som udledningen ikke må overstige i noget kalenderår. Sædskifterne kan rykkes i deres cyklus for at sprede udledningen.',
    chooseWhen:
      'Vælg den, når kvoten skal overholdes hvert år, eller når DB2 ikke må svinge for meget mellem årene. Indstillingerne gælder kun kørslen.',
  },
}

// Loft hvert år has more to set than fits one step, so its settings are split
// in the ceilings and what else the run must respect.
const STEP_LABELS: Record<OptimizationKind, string[]> = {
  optimize: ['Type', 'Indstillinger'],
  yearly: ['Type', 'Udledningsloft', 'DB2 og afgrøder'],
}

type OptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenRules: () => void
}

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

// One dialog for both kinds: the first step chooses how the quota applies, the
// second holds that kind's settings.
export const OptimizeDialog = ({
  farmId,
  simulation,
  fields,
  open,
  onOpenChange,
  onOpenRules,
}: OptimizeDialogProps) => {
  const [kind, setKind] = useState<OptimizationKind>('optimize')
  const [stepIndex, setStepIndex] = useState(0)
  const [excludedCropCodes, setExcludedCropCodes] = useState<Set<number>>(
    new Set(),
  )
  const [catchmentInputs, setCatchmentInputs] = useState<
    Record<string, CatchmentYearlyInput>
  >({})
  const [db2SwingPct, setDb2SwingPct] = useState('')
  const { run, view, runError, startRun } = useOptimizationDialogRun(
    simulation.id,
    kind,
    open,
  )

  // The dialog always opens on the first step, however it was closed.
  if (!open && (stepIndex !== 0 || excludedCropCodes.size > 0)) {
    setStepIndex(0)
    setExcludedCropCodes(new Set())
  }

  const catchments = useCatchmentOptions(farmId, fields)
  const { data: categories = [] } = useYearlyOptimizationCandidates(
    farmId,
    simulation.id,
  )
  // Loft hvert år has no saved constraint to read back (each run sends its own
  // fresh caps), so its default is the udledningskvote, the same one Regler and
  // Gennemsnit for perioden start from.
  const catchmentQuota = effectiveMaxNLoadByCatchment(fields, [])

  const catchmentInput = (key: string): CatchmentYearlyInput => {
    if (catchmentInputs[key]) return catchmentInputs[key]
    const quota = catchmentQuota.get(key)
    return quota === undefined
      ? DEFAULT_CATCHMENT_YEARLY_INPUT
      : { sameForAllYears: true, uniform: String(quota), perYear: {} }
  }

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

  const toggleCrop = (code: number) => {
    setExcludedCropCodes((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const runOptimization = () => {
    if (kind === 'optimize') {
      startRun({
        kind: 'optimize',
        farmId,
        simulationId: simulation.id,
        input: { excludedCropCodes: Array.from(excludedCropCodes) },
        fieldsBefore: fields,
      })
      return
    }

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
    startRun({
      kind: 'yearly',
      farmId,
      simulationId: simulation.id,
      input: {
        maxNLoadByCatchment,
        db2SwingPct: trimmedSwing === '' ? null : Number(trimmedSwing),
        excludedCropCodes: Array.from(excludedCropCodes),
      },
      fieldsBefore: fields,
    })
  }

  const stepLabels = STEP_LABELS[kind]
  const lastIndex = stepLabels.length - 1
  const showingRun = Boolean(run) && view !== 'form'
  const currentIndex = showingRun ? lastIndex : stepIndex
  const steps: StepDialogStep[] = stepLabels.map((label, index) => ({
    id: String(index),
    label,
    status: index <= currentIndex ? 'complete' : 'upcoming',
  }))

  const close = () => onOpenChange(false)

  return (
    <StepDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Optimér ${simulation.name}`}
      description="Vælg, hvordan udledningskvoten skal gælde, og kør optimeringen."
      steps={steps}
      currentIndex={currentIndex}
      onStepSelect={(index) => {
        if (!showingRun) setStepIndex(index)
      }}
      actions={
        view === 'running' ? (
          <Button variant="outline" onClick={close}>
            Luk
          </Button>
        ) : view === 'succeeded' ? (
          <Button onClick={close}>Luk</Button>
        ) : (
          <>
            {stepIndex > 0 ? (
              <Button
                variant="outline"
                onClick={() => setStepIndex(stepIndex - 1)}
              >
                Tilbage
              </Button>
            ) : null}
            {stepIndex < lastIndex ? (
              <Button onClick={() => setStepIndex(stepIndex + 1)}>Næste</Button>
            ) : (
              <Button onClick={runOptimization}>Kør optimering</Button>
            )}
          </>
        )
      }
    >
      {run && showingRun ? (
        <OptimizationRunProgress run={run} />
      ) : stepIndex === 0 ? (
        <KindChoice kind={kind} onKindChange={setKind} />
      ) : kind === 'yearly' && stepIndex === 1 ? (
        <YearlyCapsStep
          catchments={catchments}
          catchmentInput={catchmentInput}
          onCatchmentInputChange={updateCatchmentInput}
        />
      ) : (
        <div className="space-y-5">
          {kind === 'optimize' ? (
            <AverageSettings
              catchments={catchments}
              fields={fields}
              simulation={simulation}
              onOpenRules={onOpenRules}
            />
          ) : (
            <YearlyBalanceSettings
              db2SwingPct={db2SwingPct}
              onDb2SwingPctChange={setDb2SwingPct}
              fieldCount={fields.length}
              estimatedSeconds={estimatedSeconds}
            />
          )}

          <CropExclusionList
            farmId={farmId}
            simulationId={simulation.id}
            excludedCodes={excludedCropCodes}
            onToggle={toggleCrop}
          />

          {runError ? (
            <LoadError className="whitespace-pre-wrap" message={runError} />
          ) : null}
        </div>
      )}
    </StepDialog>
  )
}

type KindChoiceProps = {
  kind: OptimizationKind
  onKindChange: (kind: OptimizationKind) => void
}

const KindChoice = ({ kind, onKindChange }: KindChoiceProps) => {
  const name = useId()

  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm font-medium">
        Hvordan skal udledningskvoten gælde?
      </legend>
      {/* The cards share the grid's rows, so the title and both paragraphs
          start at the same height in each card whatever the text lengths. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {KIND_ORDER.map((option) => {
          const checked = option === kind
          const { appliesTo, chooseWhen } = KIND_DESCRIPTIONS[option]
          return (
            <label
              key={option}
              className={cn(
                'row-span-3 grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] grid-rows-subgrid gap-x-2.5 gap-y-2 rounded-lg border p-4 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                checked
                  ? 'border-primary bg-primary/5'
                  : 'bg-background hover:bg-muted/50',
              )}
            >
              <input
                type="radio"
                name={name}
                className="self-center"
                checked={checked}
                onChange={() => onKindChange(option)}
              />
              <span className="font-medium">
                {OPTIMIZATION_KIND_LABELS[option]}
              </span>
              <span className="col-start-2 text-xs">{appliesTo}</span>
              <span className="col-start-2 text-xs text-muted-foreground">
                {chooseWhen}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const formatLimit = (value: number | null, unit: string) =>
  value === null ? 'Ingen grænse' : `${formatNumber(value)} ${unit}`

type AverageSettingsProps = {
  catchments: ReturnType<typeof useCatchmentOptions>
  simulation: Simulation
  fields: FieldRecord[]
  onOpenRules: () => void
}

const AverageSettings = ({
  catchments,
  simulation,
  fields,
  onOpenRules,
}: AverageSettingsProps) => {
  const { constraints } = simulation
  const effectiveMaxNLoad = effectiveMaxNLoadByCatchment(
    fields,
    constraints.maxNLoadByCatchment,
  )

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Kør optimeringen med de regler, der er gemt på simuleringen.
      </p>

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
            <dt className="text-muted-foreground">
              Maks. udledning, gennemsnit for perioden
            </dt>
            <dd>
              {catchments.length === 0 ? (
                'Ingen grænse'
              ) : (
                <ul className="space-y-0.5">
                  {catchments.map((catchment) => {
                    const key = catchmentKey(catchment.catchmentId)
                    return (
                      <li key={key}>
                        {catchment.label}:{' '}
                        {formatLimit(
                          effectiveMaxNLoad.get(key) ?? null,
                          'kg N',
                        )}
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
    </>
  )
}

type YearlyCapsStepProps = {
  catchments: ReturnType<typeof useCatchmentOptions>
  catchmentInput: (key: string) => CatchmentYearlyInput
  onCatchmentInputChange: (
    key: string,
    patch: Partial<CatchmentYearlyInput>,
  ) => void
}

const YearlyCapsStep = ({
  catchments,
  catchmentInput,
  onCatchmentInputChange,
}: YearlyCapsStepProps) => (
  <div className="space-y-5">
    <p className="text-sm text-muted-foreground">
      Udledningen må ikke overstige loftet i noget kalenderår. Alle sædskifter
      kan rykkes frem eller tilbage i deres cyklus for at sprede den.
    </p>

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
                <span className="text-sm font-medium">{catchment.label}</span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={input.sameForAllYears}
                    onChange={(event) =>
                      onCatchmentInputChange(key, {
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
                      onCatchmentInputChange(key, {
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
                          onCatchmentInputChange(key, {
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
  </div>
)

type YearlyBalanceSettingsProps = {
  db2SwingPct: string
  onDb2SwingPctChange: (value: string) => void
  fieldCount: number
  estimatedSeconds: number
}

const YearlyBalanceSettings = ({
  db2SwingPct,
  onDb2SwingPctChange,
  fieldCount,
  estimatedSeconds,
}: YearlyBalanceSettingsProps) => {
  const swingId = useId()

  return (
    <>
      <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong"
          aria-hidden="true"
        />
        <p className="text-xs text-warning-strong">
          Indstillingerne for Loft hvert år gælder{' '}
          <strong>kun denne kørsel</strong> og gemmes ikke på simuleringen - de
          vises derfor ikke under Regler. Noter dem, hvis du skal kunne gentage
          kørslen.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={swingId}>Maks. udsving i DB2 mellem år</Label>
        <Input
          id={swingId}
          type="number"
          min="0"
          value={db2SwingPct}
          placeholder="Ingen grænse"
          onChange={(event) => onDb2SwingPctChange(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          % - intet års samlede DB2 må afvige mere end dette fra gennemsnittet
          af simuleringens år
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Alle sædskifter kan forskydes · {fieldCount} marker · ~
        {estimatedSeconds < 1 ? '<1' : Math.round(estimatedSeconds)} sek.
        (estimat, ikke en garanti)
      </p>
    </>
  )
}

type CropExclusionListProps = {
  farmId: string
  simulationId: string
  excludedCodes: Set<number>
  onToggle: (code: number) => void
}

const CropExclusionList = ({
  farmId,
  simulationId,
  excludedCodes,
  onToggle,
}: CropExclusionListProps) => {
  const {
    data: crops = [],
    error,
    isLoading,
    isValidating,
    mutate: retry,
  } = useScenarioCropCodes(farmId, simulationId)

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        Henter afgrøder...
      </p>
    )
  }

  if (error) {
    return (
      <LoadError
        message="Kunne ikke hente simuleringens afgrøder, så ingen kan fravælges."
        onRetry={() => void retry()}
        retrying={isValidating}
      />
    )
  }

  if (crops.length === 0) return null

  return (
    <div className="space-y-2">
      <Label>Afgrøder</Label>
      <p className="text-xs text-muted-foreground">
        Fravælg en afgrøde for at udelukke alle sædskifter, der indeholder den
        et eller flere steder. Valget gælder kun denne kørsel.
      </p>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {crops.map((crop) => (
          <label
            key={crop.code}
            className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={!excludedCodes.has(crop.code)}
              onChange={() => onToggle(crop.code)}
            />
            <span>{crop.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
