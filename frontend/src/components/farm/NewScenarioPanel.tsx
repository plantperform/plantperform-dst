import { useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationsKey,
  useRotationKategorier,
  useRotationNNormProcenter,
} from '@/api/hooks'
import { createSimulation } from '@/api/mutations'
import type { FieldRecord, Simulation } from '@/api/types'
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
  FDATO_OPTIONS,
  FDATO_STANDARD_INTERVALS,
  fdatoEffectPercent,
} from '@/lib/nles5-detail-labels'

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
  const { data: kategorier = [] } = useRotationKategorier(farmId)
  const { data: nNormProcenter = [] } = useRotationNNormProcenter(farmId)

  const [scenarioName, setScenarioName] = useState('')
  const [selectedKategorier, setSelectedKategorier] = useState<Set<string>>(new Set())
  const [selectedNNorm, setSelectedNNorm] = useState<Set<string>>(new Set())
  const [precisionDagsbasis, setPrecisionDagsbasis] = useState(false)
  const [fdatoInterval, setFdatoInterval] = useState(FDATO_STANDARD_INTERVALS[0].date)
  const [fdatoDate, setFdatoDate] = useState('20/8')
  const [isCreating, setIsCreating] = useState(false)

  const eeaFdato = precisionDagsbasis ? fdatoDate : fdatoInterval

  const toggleSet = (
    set: Set<string>,
    setSet: (next: Set<string>) => void,
    value: string,
  ) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setSet(next)
  }

  const canCreate =
    scenarioName.trim() !== '' &&
    selectedKategorier.size > 0 &&
    selectedNNorm.size > 0 &&
    fields.length > 0

  const createScenario = async () => {
    const name = scenarioName.trim()
    if (!name) {
      onError('Indtast et navn til scenariet.')
      return
    }
    if (selectedKategorier.size === 0) {
      onError('Vælg mindst én sædskifte-kategori.')
      return
    }
    if (selectedNNorm.size === 0) {
      onError('Vælg mindst én N-norm%.')
      return
    }

    setIsCreating(true)
    try {
      const simulation = await createSimulation(farmId, {
        name,
        kategorier: Array.from(selectedKategorier),
        nNormProcenter: Array.from(selectedNNorm),
        eeaFdato,
        eeaPrecisionDagsbasis: precisionDagsbasis,
      })
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
      setScenarioName('')
      setSelectedKategorier(new Set())
      setSelectedNNorm(new Set())
      setPrecisionDagsbasis(false)
      setFdatoInterval(FDATO_STANDARD_INTERVALS[0].date)
      setFdatoDate('20/8')
    } catch {
      onError('Kunne ikke oprette scenariet.')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nyt scenarie</DialogTitle>
          <DialogDescription>
            Scenariet oprettes med de {fields.length}{' '}
            {fields.length === 1 ? 'mark, der er valgt' : 'marker, der er valgt'} under "Aktuel".
            Alle sædskifte-kandidater der matcher dine valg beregnes og gøres klar i baggrunden —
            du bruger derefter "Optimér" til at vælge det bedste sædskifte pr. mark.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="scenario-name">Scenarie-navn</Label>
            <Input
              id="scenario-name"
              placeholder="Reduceret kvælstofscenarie"
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Sædskifte-kategorier</Label>
            <p className="text-xs text-muted-foreground">
              Driftsform og gødningsniveau følger kategorien — vælg én eller flere.
            </p>
            <div className="space-y-1">
              {kategorier.map((option) => (
                <label
                  key={option.kategori}
                  className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedKategorier.has(option.kategori)}
                    onChange={() =>
                      toggleSet(selectedKategorier, setSelectedKategorier, option.kategori)
                    }
                  />
                  <span>
                    <span className="font-medium">{option.kategori}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.dyrkningssystem} · {option.antalSaedskifter} sædskifter
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>N-norm%</Label>
            <p className="text-xs text-muted-foreground">
              Hvor stor en andel af den fulde N-norm der skal indgå — vælg ét eller flere niveauer.
            </p>
            <div className="flex flex-wrap gap-2">
              {nNormProcenter.map((value) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
                    selectedNNorm.has(value)
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'bg-background hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selectedNNorm.has(value)}
                    onChange={() => toggleSet(selectedNNorm, setSelectedNNorm, value)}
                  />
                  {value}%
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Efterafgrøde-etablering</Label>
            <p className="text-xs text-muted-foreground">
              Sådato/etableringsinterval for efterafgrøde (EEA) — gælder for alle år med
              efterafgrøde på tværs af scenariets marker.
            </p>
            <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={precisionDagsbasis}
                onChange={(event) => setPrecisionDagsbasis(event.target.checked)}
              />
              <span>
                <span className="font-medium">
                  Etableret med præcisionsteknologi (§38 — dagsbasis-effekt)
                </span>
                <span className="block text-xs text-muted-foreground">
                  Kun hvis udstyr med autostyring udfører positions- og datobestemt såning.
                  Ellers bruges standard-trappesatserne fra §37.
                </span>
              </span>
            </label>

            {precisionDagsbasis ? (
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={fdatoDate}
                onChange={(event) => setFdatoDate(event.target.value)}
              >
                {FDATO_OPTIONS.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={fdatoInterval}
                onChange={(event) => setFdatoInterval(event.target.value)}
              >
                {FDATO_STANDARD_INTERVALS.map((interval) => (
                  <option key={interval.date} value={interval.date}>
                    {interval.label}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-muted-foreground">
              NUAR EEA-effekt: {fdatoEffectPercent(eeaFdato, precisionDagsbasis).toFixed(1)}%
              ({precisionDagsbasis ? 'dagsbasis, §38' : 'trappesats, §37'})
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => void createScenario()} disabled={!canCreate || isCreating}>
              {isCreating ? 'Opretter scenarie...' : 'Opret scenarie'}
            </Button>
            {isCreating ? (
              <p className="text-sm text-muted-foreground">
                Beregner sædskifte-kandidater for alle marker — kan tage et øjeblik.
              </p>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
