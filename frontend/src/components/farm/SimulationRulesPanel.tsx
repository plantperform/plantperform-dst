import { Info, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { mutate } from 'swr'

import { simulationsKey } from '@/api/hooks'
import { updateSimulationConstraints } from '@/api/mutations'
import type { OptimizationConstraints, Simulation } from '@/api/types'
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

const numberToInput = (value: number | null) =>
  value === null ? '' : String(value)

const inputToOptionalNumber = (value: string) => {
  const trimmed = value.trim()
  return trimmed === '' ? null : Number(trimmed)
}

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

type SimulationRulesPanelProps = {
  farmId: string
  simulation: Simulation
}

export const SimulationRulesPanel = ({
  farmId,
  simulation,
}: SimulationRulesPanelProps) => {
  const [constraints, setConstraints] = useState(simulation.constraints)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaved, setIsSaved] = useState(false)

  const editConstraints = (
    update: (current: OptimizationConstraints) => OptimizationConstraints,
  ) => {
    setIsSaved(false)
    setConstraints(update)
  }

  const saveConstraints = async () => {
    setIsSaving(true)
    try {
      const updated = await updateSimulationConstraints(
        farmId,
        simulation.id,
        constraints,
      )
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        { revalidate: false },
      )
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
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Grænser</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="rules-max-n-load">Maks. tilladt udledning</Label>
              <Input
                id="rules-max-n-load"
                type="number"
                min="0"
                value={numberToInput(constraints.maxNLoadKg)}
                placeholder="Ingen grænse"
                onChange={(event) =>
                  editConstraints((current) => ({
                    ...current,
                    maxNLoadKg: inputToOptionalNumber(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">kg N</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rules-min-fen">Min. foderenheder</Label>
              <Input
                id="rules-min-fen"
                type="number"
                min="0"
                value={numberToInput(constraints.minFen)}
                placeholder="Ingen grænse"
                onChange={(event) =>
                  editConstraints((current) => ({
                    ...current,
                    minFen: inputToOptionalNumber(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">FE</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rules-max-fen">Maks. foderenheder</Label>
              <Input
                id="rules-max-fen"
                type="number"
                min="0"
                value={numberToInput(constraints.maxFen)}
                placeholder="Ingen grænse"
                onChange={(event) =>
                  editConstraints((current) => ({
                    ...current,
                    maxFen: inputToOptionalNumber(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">FE</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => void saveConstraints()}
              disabled={isSaving}
            >
              {isSaving ? 'Gemmer...' : 'Gem grænser'}
            </Button>
            {isSaved && !saveError ? (
              <span className="text-xs text-muted-foreground">Gemt.</span>
            ) : null}
            {saveError ? (
              <span className="text-xs text-red-700">{saveError}</span>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 border-t border-indigo-200 pt-4">
          <h3 className="text-sm font-semibold">
            Scenariets grundlag
            <span className="ml-2 font-normal text-xs text-muted-foreground">
              låst ved oprettelse — kandidaterne blev genereret ud fra dette
            </span>
          </h3>
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
            forskydes gemmes ikke på scenariet — de gælder kun den enkelte
            kørsel og nulstilles, når dialogen lukkes. Notér dem selv, hvis du
            skal kunne gentage en kørsel.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
