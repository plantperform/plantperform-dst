import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationsKey,
  useGodningsPresets,
  useRotationKategorier,
  useRotationNNormProcenter,
} from '@/api/hooks'
import { createSimulation } from '@/api/mutations'
import type {
  FieldRecord,
  GodningSettings,
  RotationKategoriOption,
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
  const { data: godningsPresets = [] } = useGodningsPresets(farmId)

  const [scenarioName, setScenarioName] = useState('')
  const [selectedByKategori, setSelectedByKategori] = useState<
    Record<string, Set<string>>
  >({})
  const [expandedKategorier, setExpandedKategorier] = useState<Set<string>>(
    new Set(),
  )
  const [selectedNNorm, setSelectedNNorm] = useState<Set<string>>(new Set())
  const [godningsTypeValg, setGodningsTypeValg] = useState('ingen')
  const [driftsform, setDriftsform] = useState<GodningSettings['driftsform']>('Konventionel')
  const [orgMineralN, setOrgMineralN] = useState('0')
  const [mineralskAndelPct, setMineralskAndelPct] = useState('100')
  const [onlyOrganic, setOnlyOrganic] = useState(false)
  const [precisionDagsbasis, setPrecisionDagsbasis] = useState(false)
  const [fdatoInterval, setFdatoInterval] = useState(FDATO_STANDARD_INTERVALS[0].date)
  const [fdatoDate, setFdatoDate] = useState('20/8')
  const [isCreating, setIsCreating] = useState(false)

  const applyGodningsTypeValg = (value: string) => {
    setGodningsTypeValg(value)
    if (value === 'ingen') {
      setOrgMineralN('0')
      setMineralskAndelPct('100')
      setOnlyOrganic(false)
      return
    }
    if (value === 'brugerdefineret') return

    const preset = godningsPresets.find((p) => p.navn === value)
    if (!preset) return
    // Driftsform sættes IKKE fra preset'et — samme gødningstype (fx
    // Kvæggylle) bruges uanset om marken er konventionel eller økologisk;
    // driftsform styres udelukkende af den separate vælger ovenfor.
    setOrgMineralN(String(preset.godning.orgMineralN))
    setMineralskAndelPct(String(preset.godning.mineralskAndelPct))
    setOnlyOrganic(preset.godning.onlyOrganic)
  }

  const eeaFdato = precisionDagsbasis ? fdatoDate : fdatoInterval

  const selectedFor = (kategori: string): Set<string> =>
    selectedByKategori[kategori] ?? new Set()

  const toggleKategoriAll = (option: RotationKategoriOption) => {
    const current = selectedFor(option.kategori)
    const allSelected =
      option.saedskifter.length > 0 && current.size === option.saedskifter.length
    setSelectedByKategori((prev) => ({
      ...prev,
      [option.kategori]: allSelected
        ? new Set()
        : new Set(option.saedskifter.map((s) => s.saedskiftevariant)),
    }))
  }

  const toggleSaedskifte = (kategori: string, saedskiftevariant: string) => {
    setSelectedByKategori((prev) => {
      const next = new Set(prev[kategori] ?? [])
      if (next.has(saedskiftevariant)) next.delete(saedskiftevariant)
      else next.add(saedskiftevariant)
      return { ...prev, [kategori]: next }
    })
  }

  const toggleExpanded = (kategori: string) =>
    toggleSet(expandedKategorier, setExpandedKategorier, kategori)

  const hasAnySelection = Object.values(selectedByKategori).some(
    (set) => set.size > 0,
  )

  const canCreate =
    scenarioName.trim() !== '' &&
    hasAnySelection &&
    selectedNNorm.size > 0 &&
    fields.length > 0

  const createScenario = async () => {
    const name = scenarioName.trim()
    if (!name) {
      onError('Indtast et navn til scenariet.')
      return
    }
    if (!hasAnySelection) {
      onError('Vælg mindst ét sædskifte i mindst én kategori.')
      return
    }
    if (selectedNNorm.size === 0) {
      onError('Vælg mindst én N-norm%.')
      return
    }

    setIsCreating(true)
    try {
      const saedskiftevarianter = Array.from(
        new Set(
          Object.values(selectedByKategori).flatMap((set) => Array.from(set)),
        ),
      )
      const simulation = await createSimulation(farmId, {
        name,
        saedskiftevarianter,
        nNormProcenter: Array.from(selectedNNorm),
        godning: {
          driftsform,
          orgMineralN: Number(orgMineralN) || 0,
          mineralskAndelPct: Number(mineralskAndelPct) || 100,
          onlyOrganic,
        },
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
      setSelectedByKategori({})
      setExpandedKategorier(new Set())
      setSelectedNNorm(new Set())
      setGodningsTypeValg('ingen')
      setDriftsform('Konventionel')
      setOrgMineralN('0')
      setMineralskAndelPct('100')
      setOnlyOrganic(false)
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
            <Label>Sædskifter</Label>
            <p className="text-xs text-muted-foreground">
              Grupperet efter sædskifte-type til overblik — gødning vælges separat
              nedenfor og er uafhængig af hvilke sædskifter du vælger her. Fold en
              gruppe ud for at vælge specifikke sædskifter til/fra — ellers indgår alle.
            </p>
            <div className="space-y-1">
              {kategorier.map((option) => {
                const selected = selectedFor(option.kategori)
                const allSelected =
                  option.saedskifter.length > 0 &&
                  selected.size === option.saedskifter.length
                const partiallySelected = selected.size > 0 && !allSelected
                const isExpanded = expandedKategorier.has(option.kategori)
                return (
                  <div key={option.kategori} className="rounded-md border bg-background">
                    <div className="flex items-start gap-2 p-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={allSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = partiallySelected
                        }}
                        onChange={() => toggleKategoriAll(option)}
                      />
                      <button
                        type="button"
                        className="flex flex-1 items-start justify-between gap-2 text-left"
                        onClick={() => toggleExpanded(option.kategori)}
                      >
                        <span>
                          <span className="font-medium">{option.kategori}</span>
                          <span className="block text-xs text-muted-foreground">
                            {selected.size}/{option.antalSaedskifter} sædskifter valgt
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
                        {option.saedskifter.map((saedskifte) => (
                          <label
                            key={saedskifte.saedskiftevariant}
                            className="flex items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={selected.has(saedskifte.saedskiftevariant)}
                              onChange={() =>
                                toggleSaedskifte(
                                  option.kategori,
                                  saedskifte.saedskiftevariant,
                                )
                              }
                            />
                            <span>{saedskifte.cropSequence.join(' - ')}</span>
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
              Uafhængig af hvilke sædskifter du har valgt ovenfor — samme
              gødningsvalg bruges for alle valgte sædskifter i scenariet.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">Driftsform</span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={driftsform}
                  onChange={(event) =>
                    setDriftsform(event.target.value as GodningSettings['driftsform'])
                  }
                >
                  <option value="Konventionel">Konventionel</option>
                  <option value="Økologisk">Økologisk</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">Gødningstype</span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={godningsTypeValg}
                  onChange={(event) => applyGodningsTypeValg(event.target.value)}
                >
                  <option value="ingen">Ingen organisk gødning (ren handelsgødning)</option>
                  {godningsPresets.map((preset) => (
                    <option key={preset.navn} value={preset.navn}>
                      {preset.navn}
                    </option>
                  ))}
                  <option value="brugerdefineret">Brugerdefineret</option>
                </select>
              </label>
            </div>

            {godningsTypeValg !== 'ingen' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Udnyttet N fra organisk gødning (kg N/ha)
                  </span>
                  <Input
                    type="number"
                    min="0"
                    value={orgMineralN}
                    onChange={(event) => setOrgMineralN(event.target.value)}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">Mineralsk andel (%)</span>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={mineralskAndelPct}
                    onChange={(event) => setMineralskAndelPct(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {godningsTypeValg !== 'ingen' ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyOrganic}
                  onChange={(event) => setOnlyOrganic(event.target.checked)}
                />
                Kun organisk gødning (ingen handelsgødnings-optopning) — typisk økologisk
              </label>
            ) : null}
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
