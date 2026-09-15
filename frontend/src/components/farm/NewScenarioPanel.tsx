import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
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
  RotationCategoryOption,
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
  const { data: categories = [] } = useRotationCategories(farmId)
  const { data: nNormOptions = [] } = useRotationNNormPercentages(farmId)
  const { data: fertiliserPresets = [] } = useFertiliserPresets(farmId)

  const [scenarioName, setScenarioName] = useState('')
  const [selectedByCategory, setSelectedByCategory] = useState<
    Record<string, Set<string>>
  >({})
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  )
  const [selectedNNorm, setSelectedNNorm] = useState<Set<string>>(new Set())
  const [fertiliserTypeChoice, setFertiliserTypeChoice] = useState('none')
  const [farmingSystem, setFarmingSystem] =
    useState<FertiliserSettings['farmingSystem']>('Konventionel')
  const [orgMineralN, setOrgMineralN] = useState('0')
  const [mineralSharePct, setMineralSharePct] = useState('100')
  const [onlyOrganic, setOnlyOrganic] = useState(false)
  const [nContentKgPerTon, setNContentKgPerTon] = useState('6')
  const [precisionDailyBasis, setPrecisionDailyBasis] = useState(false)
  const [precisionFarming, setPrecisionFarming] = useState(false)
  const [earlySowing, setEarlySowing] = useState(true)
  const [intermediateCrop, setIntermediateCrop] = useState(true)
  const [sowingDateInterval, setSowingDateInterval] = useState(SOWING_DATE_INTERVALS[0].date)
  const [sowingDate, setSowingDate] = useState('20/8')
  const [isCreating, setIsCreating] = useState(false)

  const applyFertiliserTypeChoice = (value: string) => {
    setFertiliserTypeChoice(value)
    if (value === 'none') {
      setOrgMineralN('0')
      setMineralSharePct('100')
      setOnlyOrganic(farmingSystem === 'Økologisk')
      return
    }
    if (value === 'custom') return

    const preset = fertiliserPresets.find((p) => p.name === value)
    if (!preset) return
    // Do NOT set farmingSystem from the preset: the same fertiliser type (for example,
    // Kvæggylle) is used whether the field is conventional or organic.
    // FarmingSystem is controlled solely by the separate selector above. However,
    // "kun organisk gødning" must always follow farmingSystem rather than the
    // preset's own conventionally shaped value, regardless of the order in
    // which the user selects farmingSystem and fertiliser type.
    setOrgMineralN(String(preset.fertiliser.orgMineralN))
    setMineralSharePct(String(preset.fertiliser.mineralSharePct))
    setOnlyOrganic(
      farmingSystem === 'Økologisk' ? true : preset.fertiliser.onlyOrganic,
    )
  }

  const catchCropSowingDate = precisionDailyBasis ? sowingDate : sowingDateInterval

  const selectedFor = (category: string): Set<string> =>
    selectedByCategory[category] ?? new Set()

  const toggleCategoryAll = (option: RotationCategoryOption) => {
    const current = selectedFor(option.category)
    const allSelected =
      option.rotations.length > 0 && current.size === option.rotations.length
    setSelectedByCategory((prev) => ({
      ...prev,
      [option.category]: allSelected
        ? new Set()
        : new Set(option.rotations.map((s) => s.rotationVariant)),
    }))
  }

  const toggleRotation = (category: string, rotationVariant: string) => {
    setSelectedByCategory((prev) => {
      const next = new Set(prev[category] ?? [])
      if (next.has(rotationVariant)) next.delete(rotationVariant)
      else next.add(rotationVariant)
      return { ...prev, [category]: next }
    })
  }

  const toggleExpanded = (category: string) =>
    toggleSet(expandedCategories, setExpandedCategories, category)

  const hasAnySelection = Object.values(selectedByCategory).some(
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
      onError('Indtast et navn til simuleringen.')
      return
    }
    if (!hasAnySelection) {
      onError('Vælg mindst et sædskifte i mindst en kategori.')
      return
    }
    if (selectedNNorm.size === 0) {
      onError('Vælg mindst en N-norm%.')
      return
    }

    setIsCreating(true)
    try {
      const allowedRotationVariants = Array.from(
        new Set(
          Object.values(selectedByCategory).flatMap((set) => Array.from(set)),
        ),
      )
      const simulation = await createSimulation(farmId, {
        name,
        allowedRotationVariants,
        allowedNNormPercentages: Array.from(selectedNNorm),
        fertiliser: {
          farmingSystem,
          orgMineralN: Number(orgMineralN) || 0,
          mineralSharePct: Number(mineralSharePct) || 100,
          onlyOrganic,
          nContentKgPerTon: Number(nContentKgPerTon) || 6,
        },
        catchCropSowingDate,
        catchCropDailyBasis: precisionDailyBasis,
        precisionFarming,
        earlySowing,
        intermediateCrop,
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
      setSelectedByCategory({})
      setExpandedCategories(new Set())
      setSelectedNNorm(new Set())
      setFertiliserTypeChoice('none')
      setFarmingSystem('Konventionel')
      setOrgMineralN('0')
      setMineralSharePct('100')
      setOnlyOrganic(false)
      setPrecisionDailyBasis(false)
      setPrecisionFarming(false)
      setEarlySowing(true)
      setIntermediateCrop(true)
      setSowingDateInterval(SOWING_DATE_INTERVALS[0].date)
      setSowingDate('20/8')
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
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scenario-farming-system">Driftsform</Label>
            <select
              id="scenario-farming-system"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={farmingSystem}
              onChange={(event) => {
                const value = event.target
                  .value as FertiliserSettings['farmingSystem']
                setFarmingSystem(value)
                setOnlyOrganic(value === 'Økologisk')
              }}
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
                const selected = selectedFor(option.category)
                const allSelected =
                  option.rotations.length > 0 &&
                  selected.size === option.rotations.length
                const partiallySelected = selected.size > 0 && !allSelected
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
                        onChange={() => toggleCategoryAll(option)}
                      />
                      <button
                        type="button"
                        className="flex flex-1 items-start justify-between gap-2 text-left"
                        onClick={() => toggleExpanded(option.category)}
                      >
                        <span>
                          <span className="font-medium">{option.category}</span>
                          <span className="block text-xs text-muted-foreground">
                            {selected.size}/{option.rotationCount} sædskifter
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
                              checked={selected.has(rotation.rotationVariant)}
                              onChange={() =>
                                toggleRotation(
                                  option.category,
                                  rotation.rotationVariant,
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
                value={fertiliserTypeChoice}
                onChange={(event) =>
                  applyFertiliserTypeChoice(event.target.value)
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

            {fertiliserTypeChoice !== 'none' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Maks tilladt udnyttet N fra organisk gødning (kg N/ha)
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
                    value={mineralSharePct}
                    onChange={(event) => setMineralSharePct(event.target.value)}
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
                    value={nContentKgPerTon}
                    onChange={(event) =>
                      setNContentKgPerTon(event.target.value)
                    }
                  />
                  <span className="block text-xs text-muted-foreground">
                    Typisk kvæggylle: 4–7 kg udnyttet N/ton. Bruges til at
                    omregne til ton gødning brugt pr. mark pr. år (reference,
                    ingen beregningseffekt).
                    {(() => {
                      const utilisedPerTon = Number(nContentKgPerTon)
                      const mineralPct = Number(mineralSharePct)
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

            {fertiliserTypeChoice !== 'none' ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyOrganic}
                  onChange={(event) => setOnlyOrganic(event.target.checked)}
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
              Sådato/etableringsinterval for efterafgrøde (EEA) - gælder for alle år med
              efterafgrøde på tværs af simuleringens marker.
            </p>
            <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={precisionDailyBasis}
                onChange={(event) =>
                  setPrecisionDailyBasis(event.target.checked)
                }
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

            {precisionDailyBasis ? (
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={sowingDate}
                onChange={(event) => setSowingDate(event.target.value)}
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
                value={sowingDateInterval}
                onChange={(event) => setSowingDateInterval(event.target.value)}
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
              {sowingDateEffectPercent(catchCropSowingDate, precisionDailyBasis).toFixed(1)}% (
              {precisionDailyBasis ? 'dagsbasis, §38' : 'trappesats, §37'})
            </p>
          </div>

          <div className="space-y-2">
            <Label>Præcisionsjordbrug</Label>
            <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={precisionFarming}
                onChange={(event) => setPrecisionFarming(event.target.checked)}
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
                checked={earlySowing}
                onChange={(event) => setEarlySowing(event.target.checked)}
              />
              <span className="font-medium">Tillad tidlig såning</span>
            </label>
            <label className="flex items-center gap-3 rounded-md border bg-background p-3 text-sm">
              <input
                type="checkbox"
                checked={intermediateCrop}
                onChange={(event) => setIntermediateCrop(event.target.checked)}
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
