import { Info, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { mutate } from 'swr'

import { simulationsKey } from '@/api/hooks'
import { updateSimulationConstraints } from '@/api/mutations'
import type {
  FieldRecord,
  CatchmentNLoadCap,
  OptimizationConstraints,
  Simulation,
} from '@/api/types'
import {
  catchmentKey,
  inputToOptionalNumber,
  numberToInput,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ReadOnlyRuleProps = {
  label: string
  value: string
}

const ReadOnlyRule = ({ label, value }: ReadOnlyRuleProps) => (
  <div className="space-y-1">
    <div className="text-xs font-medium text-muted-foreground">{label}</div>
    <div className="text-sm">{value}</div>
  </div>
)

const buildMaxNLoadInputs = (
  constraints: OptimizationConstraints,
): Record<string, string> =>
  Object.fromEntries(
    constraints.maxNLoadByCatchment.map((cap) => [
      catchmentKey(cap.catchmentId),
      numberToInput(cap.maxNLoadKg),
    ]),
  )

type SimulationRulesPanelProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
}

export const SimulationRulesPanel = ({
  farmId,
  simulation,
  fields,
}: SimulationRulesPanelProps) => {
  const [minFeedUnits, setMinFeedUnits] = useState(simulation.constraints.minFeedUnits)
  const [maxFeedUnits, setMaxFeedUnits] = useState(simulation.constraints.maxFeedUnits)
  const [maxNLoadInputs, setMaxNLoadInputs] = useState<Record<string, string>>(
    () => buildMaxNLoadInputs(simulation.constraints),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaved, setIsSaved] = useState(false)

  const catchments = useCatchmentOptions(farmId, fields)

  const maxNLoadByCatchment: CatchmentNLoadCap[] = catchments.map(
    (catchment) => ({
      catchmentId: catchment.catchmentId,
      maxNLoadKg: inputToOptionalNumber(
        maxNLoadInputs[catchmentKey(catchment.catchmentId)] ?? '',
      ),
    }),
  )

  const savedMaxNLoadByKey = new Map(
    simulation.constraints.maxNLoadByCatchment.map((cap) => [
      catchmentKey(cap.catchmentId),
      cap.maxNLoadKg,
    ]),
  )
  const isDirty =
    minFeedUnits !== simulation.constraints.minFeedUnits ||
    maxFeedUnits !== simulation.constraints.maxFeedUnits ||
    maxNLoadByCatchment.some(
      (cap) =>
        cap.maxNLoadKg !==
        (savedMaxNLoadByKey.get(catchmentKey(cap.catchmentId)) ?? null),
    )

  const editMinFeedUnits = (value: string) => {
    setIsSaved(false)
    setMinFeedUnits(inputToOptionalNumber(value))
  }

  const editMaxFeedUnits = (value: string) => {
    setIsSaved(false)
    setMaxFeedUnits(inputToOptionalNumber(value))
  }

  const editMaxNLoadInput = (key: string, value: string) => {
    setIsSaved(false)
    setMaxNLoadInputs((current) => ({ ...current, [key]: value }))
  }

  const saveConstraints = async () => {
    setIsSaving(true)
    try {
      const updated = await updateSimulationConstraints(farmId, simulation.id, {
        ...simulation.constraints,
        minFeedUnits,
        maxFeedUnits,
        maxNLoadByCatchment,
      })
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        { revalidate: false },
      )
      setMinFeedUnits(updated.constraints.minFeedUnits)
      setMaxFeedUnits(updated.constraints.maxFeedUnits)
      setMaxNLoadInputs(buildMaxNLoadInputs(updated.constraints))
      setSaveError(null)
      setIsSaved(true)
    } catch {
      setSaveError('Kunne ikke gemme grænserne.')
    } finally {
      setIsSaving(false)
    }
  }

  const { fertiliser } = simulation

  return (
    <Card className="border-rules/40 bg-rules/5">
      <CardHeader className="border-b border-rules/20">
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal
            className="h-4 w-4 text-rules"
            aria-hidden="true"
          />
          Regler for hele bedriften
        </CardTitle>
        <CardDescription>
          Her bestemmer du, hvad optimeringen må gøre. Reglerne gælder alle
          marker i denne simulering og bruges ved næste Optimér-kørsel - de er
          ikke tal, markerne har.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Grænser</h3>
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm font-medium leading-none text-foreground">
              Maks. tilladt udledning pr. kystvandopland
            </legend>
            {catchments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ingen marker med et kystvandopland i denne simulering.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {catchments.map((catchment) => {
                  const key = catchmentKey(catchment.catchmentId)
                  return (
                    <div key={key} className="space-y-1">
                      <Label
                        htmlFor={`rules-max-n-load-${key}`}
                        className="text-xs font-normal text-muted-foreground"
                      >
                        {catchment.label}
                      </Label>
                      <Input
                        id={`rules-max-n-load-${key}`}
                        type="number"
                        min="0"
                        value={maxNLoadInputs[key] ?? ''}
                        placeholder="Ingen grænse"
                        onChange={(event) =>
                          editMaxNLoadInput(key, event.target.value)
                        }
                      />
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">kg N pr. opland</p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="rules-min-feed-units">Min. foderenheder</Label>
              <Input
                id="rules-min-feed-units"
                type="number"
                min="0"
                value={numberToInput(minFeedUnits)}
                placeholder="Ingen grænse"
                onChange={(event) => editMinFeedUnits(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">FE</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rules-max-feed-units">Maks. foderenheder</Label>
              <Input
                id="rules-max-feed-units"
                type="number"
                min="0"
                value={numberToInput(maxFeedUnits)}
                placeholder="Ingen grænse"
                onChange={(event) => editMaxFeedUnits(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">FE</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={() => void saveConstraints()}
              disabled={!isDirty}
              loading={isSaving}
            >
              {isSaving ? 'Gemmer...' : 'Gem grænser'}
            </Button>
            {isDirty ? (
              <span className="text-xs font-medium text-amber-700">
                Ikke gemt
              </span>
            ) : null}
            {isSaved && !saveError ? (
              <span
                role="status"
                aria-live="polite"
                className="text-xs text-muted-foreground"
              >
                Gemt.
              </span>
            ) : null}
            {saveError ? (
              <span
                role="status"
                aria-live="polite"
                className="text-xs text-red-700"
              >
                {saveError}
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 border-t border-rules/20 pt-4">
          <h3 className="text-sm font-semibold">Simuleringens grundlag</h3>
          <p className="text-xs text-muted-foreground">
            Låst ved oprettelse - kandidaterne blev genereret ud fra dette.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <ReadOnlyRule
              label="Sædskiftevarianter"
              value={
                simulation.rotationVariants.length > 0
                  ? `${simulation.rotationVariants.length} valgt`
                  : 'Ingen valgt'
              }
            />
            <ReadOnlyRule
              label="N-norm%"
              value={
                simulation.nNormPercentages.length > 0
                  ? simulation.nNormPercentages.join(', ')
                  : 'Ingen valgt'
              }
            />
            <ReadOnlyRule label="Driftsform" value={fertiliser.farmingSystem} />
            <ReadOnlyRule
              label="Organisk bundet N"
              value={`${fertiliser.orgMineralN}`}
            />
            <ReadOnlyRule
              label="Mineralsk andel"
              value={`${fertiliser.mineralSharePct} %`}
            />
            <ReadOnlyRule
              label="N-indhold i husdyrgødning"
              value={`${fertiliser.nContentKgPerTon} kg N/ton`}
            />
            <ReadOnlyRule
              label="Kun organisk gødning"
              value={fertiliser.onlyOrganic ? 'Ja' : 'Nej'}
            />
            <ReadOnlyRule
              label="Efterafgrøde-etablering"
              value={simulation.catchCropSowingDate}
            />
            <ReadOnlyRule
              label="Præcision på dagsbasis"
              value={simulation.catchCropDailyBasis ? 'Ja' : 'Nej'}
            />
          </div>
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          Års-optimeringens indstillinger gemmes ikke her - de gælder kun den
          enkelte kørsel.
        </p>
      </CardContent>
    </Card>
  )
}
