import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationsKey,
  simulationYearlySummaryKey,
  useSimulationFields,
  useYearlyOptimizationCandidates,
} from '@/api/hooks'
import {
  runSimulationOptimization,
  runYearlySimulationOptimization,
  updateSimulationConstraints,
} from '@/api/mutations'
import type {
  Farm,
  FieldRecord,
  OptimizeSimulationResponse,
  Simulation,
  YearlyOptimizationKategoriOption,
} from '@/api/types'
import { FarmFieldsList } from '@/components/farm/FarmFieldsList'
import {
  DEFAULT_FIELDS_SORT,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import { FarmFieldsMap } from '@/components/farm/FarmFieldsMap'
import type { FarmViewSelection } from '@/components/farm/types'
import { YearlyOverviewStrip } from '@/components/farm/YearlyOverviewStrip'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ROTATION_START_CALENDAR_YEAR } from '@/lib/field-domain'

// Efter en Optimér-/Års-optimering-kørsel er simulationFieldsKey allerede
// opdateret direkte fra respons'en (ingen ny hentning nødvendig), men
// Årsoversigt-stripet henter fra en separat SWR-nøgle der ellers ville
// blive stående med data fra FØR kørslen — usynligt for brugeren, men ser
// ud som om nye begrænsninger/lofter blev ignoreret. Tving den til at
// hente igen.
//
// "Beregningsgennemgang pr. år"-panelet (candidate-detail) invalideres
// bevidst IKKE her længere — det blev tidligere gjort med en bredt
// matchende nøgle-revalidering, der genopfriskede ALLE candidate-detail-
// nøgler brugeren nogensinde havde åbnet i denne simulering, uanset om
// marken rent faktisk fik en ny tildeling. På et scenarie med u-optimerede
// marker gav det en byge af samtidige mislykkede kald (422 "ikke
// optimeret endnu") for hver tidligere-åbnet mark. SWR genindlæser
// candidate-detail automatisk, hver gang panelet næste gang åbnes
// (mount-tids-revalidering) — det er nok i praksis.
const invalidateOptimizationDisplays = async (farmId: string, simulationId: string) => {
  await mutate(simulationYearlySummaryKey(farmId, simulationId))
}

const NUM_ROTATION_YEARS = 8
const ROTATION_CALENDAR_YEARS = Array.from(
  { length: NUM_ROTATION_YEARS },
  (_, index) => ROTATION_START_CALENDAR_YEAR + index,
)

type FarmInspectorProps = {
  farm: Farm
  fields: FieldRecord[]
  selection: FarmViewSelection
  selectedSimulation?: Simulation
  onError: (message: string | null) => void
}

export const FarmInspector = ({
  farm,
  fields,
  selection,
  selectedSimulation,
  onError,
}: FarmInspectorProps) => {
  const [view, setView] = useState<'list' | 'map'>('list')
  const [optimizeDialogOpen, setOptimizeDialogOpen] = useState(false)
  const [yearlyOptimizeDialogOpen, setYearlyOptimizeDialogOpen] = useState(false)
  const [optimizationSummary, setOptimizationSummary] =
    useState<OptimizeSimulationResponse | null>(null)
  const [fieldsSort, setFieldsSort] =
    useState<FieldsSortState>(DEFAULT_FIELDS_SORT)
  const isSimulationView = selection.kind === 'simulation'

  return (
    <section className="flex min-h-screen flex-col">
      <header className="flex flex-col gap-4 border-b bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              Markgennemgang
            </h2>
            {selectedSimulation ? (
              <span className="rounded-full border bg-muted px-2 py-0.5 text-xs font-medium">
                Simulering: {selectedSimulation.name}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {isSimulationView
              ? 'Gennemgå de kopierede marker for dette optimeringsalternativ.'
              : 'Gennemgå tilknyttede marker som liste eller direkte på kortet.'}
          </p>
          {optimizationSummary && selectedSimulation ? (
            <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              Optimering {optimizationSummary.status.toLowerCase()}: DB2{' '}
              {optimizationSummary.objectiveDb2.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
              , Udledning{' '}
              {optimizationSummary.totalNLoadKg.toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })}{' '}
              kg N, udvaskning{' '}
              {optimizationSummary.totalLeachingKg.toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })}{' '}
              kg N, foderenheder{' '}
              {optimizationSummary.totalFen.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}{' '}
              FE.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedSimulation ? (
            <Button onClick={() => setOptimizeDialogOpen(true)}>Optimér</Button>
          ) : null}
          {selectedSimulation ? (
            <Button
              variant="outline"
              onClick={() => setYearlyOptimizeDialogOpen(true)}
            >
              Års-optimering
            </Button>
          ) : null}
          <div className="flex rounded-md border bg-muted/40 p-1">
            <Button
              size="sm"
              variant={view === 'list' ? 'default' : 'outline'}
              className={
                view === 'list' ? '' : 'border-transparent bg-transparent'
              }
              onClick={() => setView('list')}
            >
              Liste
            </Button>
            <Button
              size="sm"
              variant={view === 'map' ? 'default' : 'outline'}
              className={
                view === 'map' ? '' : 'border-transparent bg-transparent'
              }
              onClick={() => setView('map')}
            >
              Kort
            </Button>
          </div>
        </div>
      </header>

      {selectedSimulation ? (
        <OptimizeDialog
          key={selectedSimulation.id}
          farmId={farm.id}
          simulation={selectedSimulation}
          open={optimizeDialogOpen}
          onOpenChange={setOptimizeDialogOpen}
          onOptimized={setOptimizationSummary}
        />
      ) : null}

      {selectedSimulation ? (
        <YearlyOptimizeDialog
          key={`yearly-${selectedSimulation.id}`}
          farmId={farm.id}
          simulation={selectedSimulation}
          open={yearlyOptimizeDialogOpen}
          onOpenChange={setYearlyOptimizeDialogOpen}
          onOptimized={setOptimizationSummary}
        />
      ) : null}

      <div className="flex-1 space-y-4 p-4">
        {view === 'list' ? (
          <>
            {isSimulationView && selection.kind === 'simulation' ? (
              <YearlyOverviewStrip farmId={farm.id} simulationId={selection.id} />
            ) : null}
            <FarmFieldsList
              farmId={farm.id}
              fields={fields}
              isSimulationView={isSimulationView}
              simulationId={
                selection.kind === 'simulation' ? selection.id : undefined
              }
              simulation={
                selection.kind === 'simulation' ? selectedSimulation : undefined
              }
              sort={fieldsSort}
              onSortChange={setFieldsSort}
              onSwitchToMap={() => setView('map')}
              onError={onError}
            />
          </>
        ) : (
          <FarmFieldsMap
            key={
              selection.kind === 'current'
                ? 'current'
                : `simulation-${selection.id}`
            }
            farm={farm}
            fields={fields}
            readOnly={isSimulationView}
            onError={onError}
          />
        )}
      </div>
    </section>
  )
}

type OptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
}

const numberToInput = (value: number | null) =>
  value === null ? '' : String(value)

const inputToOptionalNumber = (value: string) => {
  const trimmed = value.trim()
  return trimmed === '' ? null : Number(trimmed)
}

const OptimizeDialog = ({
  farmId,
  simulation,
  open,
  onOpenChange,
  onOptimized,
}: OptimizeDialogProps) => {
  const [constraints, setConstraints] = useState(simulation.constraints)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setRunError(null)
    onOpenChange(nextOpen)
  }

  const saveConstraints = async () => {
    setIsSaving(true)
    try {
      const updatedSimulation = await updateSimulationConstraints(
        farmId,
        simulation.id,
        constraints,
      )
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) =>
          current.map((currentSimulation) =>
            currentSimulation.id === updatedSimulation.id
              ? updatedSimulation
              : currentSimulation,
          ),
        { revalidate: false },
      )
      setRunError(null)
      return true
    } catch {
      setRunError('Kunne ikke gemme optimeringskrav.')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const runOptimization = async () => {
    setIsRunning(true)
    try {
      const response = await runSimulationOptimization(farmId, simulation.id)
      await mutate(
        simulationFieldsKey(farmId, simulation.id),
        response.fields,
        { revalidate: false },
      )
      await invalidateOptimizationDisplays(farmId, simulation.id)
      onOptimized(response)
      handleOpenChange(false)
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : 'Kunne ikke køre optimeringen.',
      )
    } finally {
      setIsRunning(false)
    }
  }

  const saveAndRunOptimization = async () => {
    const saved = await saveConstraints()
    if (!saved) return

    await runOptimization()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Optimér {simulation.name}</DialogTitle>
          <DialogDescription>
            Konfigurer globale krav for denne simulering, og kør optimeringen
            direkte bagefter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max-n-load">Maks. tilladt Udledning</Label>
              <Input
                id="max-n-load"
                type="number"
                min="0"
                value={numberToInput(constraints.maxNLoadKg)}
                placeholder="Ingen grænse"
                onChange={(event) =>
                  setConstraints((current) => ({
                    ...current,
                    maxNLoadKg: inputToOptionalNumber(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">kg N</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="min-fen">Min. foderenheder</Label>
              <Input
                id="min-fen"
                type="number"
                min="0"
                value={numberToInput(constraints.minFen)}
                placeholder="Ingen grænse"
                onChange={(event) =>
                  setConstraints((current) => ({
                    ...current,
                    minFen: inputToOptionalNumber(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">FE</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-fen">Maks. foderenheder</Label>
              <Input
                id="max-fen"
                type="number"
                min="0"
                value={numberToInput(constraints.maxFen)}
                placeholder="Ingen grænse"
                onChange={(event) =>
                  setConstraints((current) => ({
                    ...current,
                    maxFen: inputToOptionalNumber(event.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">FE</p>
            </div>
          </div>
        </div>

        {runError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700">
            {runError}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Annuller
          </Button>
          <Button
            variant="outline"
            onClick={() => void saveConstraints()}
            disabled={isSaving || isRunning}
          >
            {isSaving ? 'Gemmer...' : 'Gem krav'}
          </Button>
          <Button
            onClick={() => void saveAndRunOptimization()}
            disabled={isSaving || isRunning}
          >
            {isSaving || isRunning ? 'Arbejder...' : 'Gem og kør optimering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type YearlyOptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
}

const YearlyOptimizeDialog = ({
  farmId,
  simulation,
  open,
  onOpenChange,
  onOptimized,
}: YearlyOptimizeDialogProps) => {
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(20)
  const [sameForAllYears, setSameForAllYears] = useState(true)
  const [uniformMaxNLoad, setUniformMaxNLoad] = useState('')
  const [perYearMaxNLoad, setPerYearMaxNLoad] = useState<Record<number, string>>({})
  const [db2SwingPct, setDb2SwingPct] = useState('')
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set())
  const [expandedKategorier, setExpandedKategorier] = useState<Set<string>>(new Set())
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setRunError(null)
    onOpenChange(nextOpen)
  }

  const { data: fields = [] } = useSimulationFields(farmId, simulation.id)
  const { data: kategorier = [] } = useYearlyOptimizationCandidates(farmId, simulation.id)

  const togglePair = (saedskiftevariant: string, variant: string) => {
    const key = `${saedskiftevariant}:${variant}`
    setSelectedPairs((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleExpanded = (kategori: string) => {
    setExpandedKategorier((current) => {
      const next = new Set(current)
      if (next.has(kategori)) next.delete(kategori)
      else next.add(kategori)
      return next
    })
  }

  const toggleKategoriAll = (kategori: YearlyOptimizationKategoriOption) => {
    const keys = kategori.saedskifter.map(
      (s) => `${s.saedskiftevariant}:${s.variant}`,
    )
    const allSelected = keys.length > 0 && keys.every((k) => selectedPairs.has(k))
    setSelectedPairs((current) => {
      const next = new Set(current)
      if (allSelected) {
        for (const key of keys) next.delete(key)
      } else {
        for (const key of keys) next.add(key)
      }
      return next
    })
  }

  // Estimat, ikke en garanti — baseret på ~2ms pr. forskudt (mark × valgt
  // sædskifte × år-position), målt empirisk under denne funktions
  // performance-arbejde. Vokser med både antal marker og antal valgte
  // sædskifter, som brugeren selv styrer.
  const estimatedSeconds = useMemo(() => {
    const activeLenByPair = new Map<string, number>()
    for (const kategori of kategorier) {
      for (const option of kategori.saedskifter) {
        activeLenByPair.set(
          `${option.saedskiftevariant}:${option.variant}`,
          option.activeLen,
        )
      }
    }
    let totalShiftUnits = 0
    for (const pair of selectedPairs) {
      totalShiftUnits += activeLenByPair.get(pair) ?? 8
    }
    return fields.length * totalShiftUnits * 0.002
  }, [fields.length, kategorier, selectedPairs])

  const runYearlyOptimization = async () => {
    const maxNLoadByYear: Record<number, number> = {}
    if (sameForAllYears) {
      const trimmed = uniformMaxNLoad.trim()
      if (trimmed !== '') {
        for (const year of ROTATION_CALENDAR_YEARS) {
          maxNLoadByYear[year] = Number(trimmed)
        }
      }
    } else {
      for (const [year, value] of Object.entries(perYearMaxNLoad)) {
        const trimmed = value.trim()
        if (trimmed !== '') {
          maxNLoadByYear[Number(year)] = Number(trimmed)
        }
      }
    }
    const trimmedSwing = db2SwingPct.trim()
    const selectedSaedskifter = Array.from(selectedPairs).map((pair) => {
      const [saedskiftevariant, variant] = pair.split(':')
      return { saedskiftevariant, variant }
    })

    setIsRunning(true)
    try {
      const response = await runYearlySimulationOptimization(farmId, simulation.id, {
        timeLimitSeconds,
        maxNLoadByYear,
        db2SwingPct: trimmedSwing === '' ? null : Number(trimmedSwing),
        selectedSaedskifter,
      })
      await mutate(
        simulationFieldsKey(farmId, simulation.id),
        response.fields,
        { revalidate: false },
      )
      await invalidateOptimizationDisplays(farmId, simulation.id)
      onOptimized(response)
      handleOpenChange(false)
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : 'Kunne ikke køre års-optimeringen.',
      )
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Års-optimering — {simulation.name}</DialogTitle>
          <DialogDescription>
            Optimér med udledningsloft pr. kalenderår og en grænse for hvor
            meget dækningsbidraget må svinge år til år. Vælg herunder hvilke
            sædskifter der må rykkes frem/tilbage i deres cyklus for at
            overholde grænserne — du styrer selv afvejningen mellem hvor
            mange muligheder optimeringen har, og hvor lang tid den tager.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="yearly-time-limit">Tidsgrænse</Label>
            <Input
              id="yearly-time-limit"
              type="number"
              min="1"
              max="120"
              value={timeLimitSeconds}
              onChange={(event) => setTimeLimitSeconds(Number(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">sekunder</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Maks. tilladt udledning pr. år</Label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={sameForAllYears}
                  onChange={(event) => setSameForAllYears(event.target.checked)}
                />
                Samme grænse for alle år
              </label>
            </div>
            {sameForAllYears ? (
              <div className="space-y-1">
                <Input
                  type="number"
                  min="0"
                  value={uniformMaxNLoad}
                  placeholder="Ingen grænse"
                  onChange={(event) => setUniformMaxNLoad(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">kg N, gælder hvert år</p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-4">
                {ROTATION_CALENDAR_YEARS.map((year) => (
                  <label key={year} className="space-y-1 text-sm">
                    <span className="text-xs text-muted-foreground">{year}</span>
                    <Input
                      type="number"
                      min="0"
                      value={perYearMaxNLoad[year] ?? ''}
                      placeholder="Ingen grænse"
                      onChange={(event) =>
                        setPerYearMaxNLoad((current) => ({
                          ...current,
                          [year]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="yearly-db-swing">Maks. udsving i DB2 mellem år</Label>
            <Input
              id="yearly-db-swing"
              type="number"
              min="0"
              value={db2SwingPct}
              placeholder="Ingen grænse"
              onChange={(event) => setDb2SwingPct(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              % — intet års samlede DB2 må afvige mere end dette fra
              gennemsnittet af scenariets år
            </p>
          </div>

          <div className="space-y-2">
            <Label>Sædskifter der må forskydes</Label>
            <p className="text-xs text-muted-foreground">
              Kun sædskifter du vælger her kan rykkes frem/tilbage i deres
              cyklus for at overholde grænserne ovenfor — resten indgår
              stadig i optimeringen, men fastholder deres nuværende
              års-fordeling. Ingen valgt = ingen forskydning, optimeringen
              vælger da kun blandt de allerede gemte kandidater.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {kategorier.map((kategori) => {
                const isExpanded = expandedKategorier.has(kategori.kategori)
                const selectedCount = kategori.saedskifter.filter((s) =>
                  selectedPairs.has(`${s.saedskiftevariant}:${s.variant}`),
                ).length
                const allSelected =
                  kategori.saedskifter.length > 0 &&
                  selectedCount === kategori.saedskifter.length
                const partiallySelected = selectedCount > 0 && !allSelected
                return (
                  <div key={kategori.kategori} className="rounded-md">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = partiallySelected
                        }}
                        onChange={() => toggleKategoriAll(kategori)}
                      />
                      <button
                        type="button"
                        className="flex flex-1 items-center justify-between gap-2 rounded-md text-left text-sm hover:bg-muted/50"
                        onClick={() => toggleExpanded(kategori.kategori)}
                      >
                        <span>
                          {kategori.kategori}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {selectedCount}/{kategori.saedskifter.length} valgt
                          </span>
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {isExpanded ? (
                      <div className="space-y-1 border-t px-2 py-1.5">
                        {kategori.saedskifter.map((option) => {
                          const key = `${option.saedskiftevariant}:${option.variant}`
                          return (
                            <label
                              key={key}
                              className="flex items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={selectedPairs.has(key)}
                                onChange={() =>
                                  togglePair(option.saedskiftevariant, option.variant)
                                }
                              />
                              <span>
                                {option.cropSequence.join(' - ')}{' '}
                                <span className="text-muted-foreground">
                                  (variant {option.variant})
                                </span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedPairs.size} sædskifter valgt · {fields.length} marker ·
              ~{estimatedSeconds < 1 ? '<1' : Math.round(estimatedSeconds)} sek.
              (estimat, ikke en garanti)
            </p>
          </div>
        </div>

        {runError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700">
            {runError}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Annuller
          </Button>
          <Button
            onClick={() => void runYearlyOptimization()}
            disabled={isRunning}
          >
            {isRunning ? 'Arbejder...' : 'Kør års-optimering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
