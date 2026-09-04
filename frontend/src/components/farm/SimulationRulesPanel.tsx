import { Info, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { mutate } from 'swr'

import { simulationsKey } from '@/api/hooks'
import { updateSimulationConstraints } from '@/api/mutations'
import type {
  FieldRecord,
  KystvandoplandNLoadCap,
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
    constraints.maxNLoadByKystvandopland.map((cap) => [
      catchmentKey(cap.kystvandId),
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
  const [minFen, setMinFen] = useState(simulation.constraints.minFen)
  const [maxFen, setMaxFen] = useState(simulation.constraints.maxFen)
  const [maxNLoadInputs, setMaxNLoadInputs] = useState<Record<string, string>>(
    () => buildMaxNLoadInputs(simulation.constraints),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaved, setIsSaved] = useState(false)

  const catchments = useCatchmentOptions(farmId, fields)

  const maxNLoadByKystvandopland: KystvandoplandNLoadCap[] = catchments.map(
    (catchment) => ({
      kystvandId: catchment.kystvandId,
      maxNLoadKg: inputToOptionalNumber(
        maxNLoadInputs[catchmentKey(catchment.kystvandId)] ?? '',
      ),
    }),
  )

  const savedMaxNLoadByKey = new Map(
    simulation.constraints.maxNLoadByKystvandopland.map((cap) => [
      catchmentKey(cap.kystvandId),
      cap.maxNLoadKg,
    ]),
  )
  const isDirty =
    minFen !== simulation.constraints.minFen ||
    maxFen !== simulation.constraints.maxFen ||
    maxNLoadByKystvandopland.some(
      (cap) =>
        cap.maxNLoadKg !==
        (savedMaxNLoadByKey.get(catchmentKey(cap.kystvandId)) ?? null),
    )

  const editMinFen = (value: string) => {
    setIsSaved(false)
    setMinFen(inputToOptionalNumber(value))
  }

  const editMaxFen = (value: string) => {
    setIsSaved(false)
    setMaxFen(inputToOptionalNumber(value))
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
        minFen,
        maxFen,
        maxNLoadByKystvandopland,
      })
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        { revalidate: false },
      )
      setMinFen(updated.constraints.minFen)
      setMaxFen(updated.constraints.maxFen)
      setMaxNLoadInputs(buildMaxNLoadInputs(updated.constraints))
      setSaveError(null)
      setIsSaved(true)
    } catch {
      setSaveError('Kunne ikke gemme grænserne.')
    } finally {
      setIsSaving(false)
    }
  }

  const { godning } = simulation

  return (
    <Card className="border-indigo-300 bg-indigo-50/30">
      <CardHeader className="border-b border-indigo-200">
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal
            className="h-4 w-4 text-indigo-600"
            aria-hidden="true"
          />
          Regler for hele bedriften
        </CardTitle>
        <CardDescription>
          Gælder alle marker i dette scenarie. Grænserne bruges ved næste
          Optimér-kørsel.
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
                  const key = catchmentKey(catchment.kystvandId)
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
              <Label htmlFor="rules-min-fen">Min. foderenheder</Label>
              <Input
                id="rules-min-fen"
                type="number"
                min="0"
                value={numberToInput(minFen)}
                placeholder="Ingen grænse"
                onChange={(event) => editMinFen(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">FE</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rules-max-fen">Maks. foderenheder</Label>
              <Input
                id="rules-max-fen"
                type="number"
                min="0"
                value={numberToInput(maxFen)}
                placeholder="Ingen grænse"
                onChange={(event) => editMaxFen(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">FE</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={() => void saveConstraints()}
              disabled={isSaving || !isDirty}
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

        <div className="space-y-3 border-t border-indigo-200 pt-4">
          <h3 className="text-sm font-semibold">Scenariets grundlag</h3>
          <p className="text-xs text-muted-foreground">
            Låst ved oprettelse - kandidaterne blev genereret ud fra dette.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <ReadOnlyRule
              label="Sædskiftevarianter"
              value={
                simulation.rotationSaedskiftevarianter.length > 0
                  ? `${simulation.rotationSaedskiftevarianter.length} valgt`
                  : 'Ingen valgt'
              }
            />
            <ReadOnlyRule
              label="N-norm%"
              value={
                simulation.rotationNNormProcenter.length > 0
                  ? simulation.rotationNNormProcenter.join(', ')
                  : 'Ingen valgt'
              }
            />
            <ReadOnlyRule label="Driftsform" value={godning.driftsform} />
            <ReadOnlyRule
              label="Organisk bundet N"
              value={`${godning.orgMineralN}`}
            />
            <ReadOnlyRule
              label="Mineralsk andel"
              value={`${godning.mineralskAndelPct} %`}
            />
            <ReadOnlyRule
              label="N-indhold i husdyrgødning"
              value={`${godning.nIndholdKgPerTon} kg N/ton`}
            />
            <ReadOnlyRule
              label="Kun organisk gødning"
              value={godning.onlyOrganic ? 'Ja' : 'Nej'}
            />
            <ReadOnlyRule
              label="Efterafgrøde-etablering"
              value={simulation.eeaFdato}
            />
            <ReadOnlyRule
              label="Præcision på dagsbasis"
              value={simulation.eeaPrecisionDagsbasis ? 'Ja' : 'Nej'}
            />
          </div>
        </div>

        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <p className="text-xs text-amber-900">
            <strong>Års-optimeringens indstillinger vises ikke her.</strong>{' '}
            Udledningsloft pr. år, maks. DB2-udsving og hvilke sædskifter der må
            forskydes gemmes ikke på scenariet - de gælder kun den enkelte
            kørsel og nulstilles, når dialogen lukkes. Noter dem selv, hvis du
            skal kunne gentage en kørsel.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
