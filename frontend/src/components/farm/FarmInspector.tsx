import { useState } from 'react'
import { mutate } from 'swr'

import { simulationFieldsKey, simulationsKey } from '@/api/hooks'
import {
  runSimulationOptimization,
  updateSimulationConstraints,
} from '@/api/mutations'
import type {
  Crop,
  Farm,
  FieldRecord,
  OptimizationConstraints,
  OptimizeSimulationResponse,
  Simulation,
} from '@/api/types'
import { FarmFieldsList } from '@/components/farm/FarmFieldsList'
import {
  DEFAULT_FIELDS_SORT,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import { FarmFieldsMap } from '@/components/farm/FarmFieldsMap'
import { SimulationGlobalMeasures } from '@/components/farm/SimulationGlobalMeasures'
import { SimulationGlobalRotations } from '@/components/farm/SimulationGlobalRotations'
import type { FarmViewSelection } from '@/components/farm/types'
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
import { CROP_VALUES, formatCrop } from '@/lib/field-domain'

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
  const [optimizationSummary, setOptimizationSummary] =
    useState<OptimizeSimulationResponse | null>(null)
  const [initialSimulationRotations, setInitialSimulationRotations] = useState<
    Record<string, Record<string, Crop[]>>
  >({})
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
              kg N.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedSimulation ? (
            <Button onClick={() => setOptimizeDialogOpen(true)}>Optimér</Button>
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
          fieldCount={fields.length}
          open={optimizeDialogOpen}
          onOpenChange={setOptimizeDialogOpen}
          onError={onError}
          onCaptureInitialRotations={(simulationId) =>
            setInitialSimulationRotations((current) => {
              if (current[simulationId]) return current

              return {
                ...current,
                [simulationId]: Object.fromEntries(
                  fields.map((field) => [field.id, field.cropRotation]),
                ),
              }
            })
          }
          onOptimized={setOptimizationSummary}
        />
      ) : null}

      <div className="flex-1 space-y-4 p-4">
        {view === 'list' ? (
          <>
            {isSimulationView &&
            selection.kind === 'simulation' &&
            selectedSimulation ? (
              <>
                <SimulationGlobalRotations
                  key={selection.id}
                  farmId={farm.id}
                  simulation={selectedSimulation}
                  fields={fields}
                  rotationLibrary={farm.rotationLibrary}
                  onError={onError}
                />
                <SimulationGlobalMeasures
                  key={`${selection.id}-measures`}
                  farmId={farm.id}
                  simulationId={selection.id}
                  fields={fields}
                  onError={onError}
                />
              </>
            ) : null}
            <FarmFieldsList
              farmId={farm.id}
              fields={fields}
              rotationLibrary={farm.rotationLibrary}
              initialCropRotations={
                selection.kind === 'simulation'
                  ? initialSimulationRotations[selection.id]
                  : undefined
              }
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
  fieldCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
  onCaptureInitialRotations: (simulationId: string) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
}

const numberToInput = (value: number | null) =>
  value === null ? '' : String(value)

const inputToOptionalNumber = (value: string) => {
  const trimmed = value.trim()
  return trimmed === '' ? null : Number(trimmed)
}

const getFirstUnusedCrop = (constraints: OptimizationConstraints) =>
  CROP_VALUES.find(
    (crop) =>
      !constraints.cropPercentages.some(
        (constraint) => constraint.crop === crop,
      ),
  )

const OptimizeDialog = ({
  farmId,
  simulation,
  fieldCount,
  open,
  onOpenChange,
  onError,
  onCaptureInitialRotations,
  onOptimized,
}: OptimizeDialogProps) => {
  const [constraints, setConstraints] = useState(simulation.constraints)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const updateCropPercentage = (
    index: number,
    update: Partial<OptimizationConstraints['cropPercentages'][number]>,
  ) => {
    setConstraints((current) => ({
      ...current,
      cropPercentages: current.cropPercentages.map(
        (constraint, constraintIndex) =>
          constraintIndex === index ? { ...constraint, ...update } : constraint,
      ),
    }))
  }

  const addCropPercentage = () => {
    const crop = getFirstUnusedCrop(constraints)
    if (!crop) return

    setConstraints((current) => ({
      ...current,
      cropPercentages: [
        ...current.cropPercentages,
        { crop, minimumPercentage: 0 },
      ],
    }))
  }

  const removeCropPercentage = (index: number) => {
    setConstraints((current) => ({
      ...current,
      cropPercentages: current.cropPercentages.filter(
        (_, constraintIndex) => constraintIndex !== index,
      ),
    }))
  }

  const validateConstraints = () => {
    if (
      constraints.maxFieldsWithNewRotation !== null &&
      constraints.maxFieldsWithNewRotation > fieldCount
    ) {
      return `Maks. marker med nye sædskifter kan ikke overstige ${fieldCount}.`
    }

    const totalPercentage = constraints.cropPercentages.reduce(
      (sum, constraint) => sum + constraint.minimumPercentage,
      0,
    )
    if (totalPercentage > 100) {
      return 'Påkrævede afgrødeandele kan ikke overstige 100%.'
    }

    const crops = constraints.cropPercentages.map(
      (constraint) => constraint.crop,
    )
    if (new Set(crops).size !== crops.length) {
      return 'Hver afgrøde kan kun kræves én gang.'
    }

    return null
  }

  const saveConstraints = async () => {
    const validationError = validateConstraints()
    if (validationError) {
      onError(validationError)
      return false
    }

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
      onError(null)
      return true
    } catch {
      onError('Kunne ikke gemme optimeringskrav.')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const runOptimization = async () => {
    setIsRunning(true)
    try {
      onCaptureInitialRotations(simulation.id)
      const response = await runSimulationOptimization(farmId, simulation.id)
      await mutate(
        simulationFieldsKey(farmId, simulation.id),
        response.fields,
        { revalidate: false },
      )
      onOptimized(response)
      onOpenChange(false)
      onError(null)
    } catch (error) {
      onError(
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <Label htmlFor="max-new-rotations">
                Maks. marker med nye sædskifter
              </Label>
              <Input
                id="max-new-rotations"
                type="number"
                min="0"
                max={fieldCount}
                value={numberToInput(constraints.maxFieldsWithNewRotation)}
                placeholder="Ingen grænse"
                onChange={(event) =>
                  setConstraints((current) => ({
                    ...current,
                    maxFieldsWithNewRotation: inputToOptionalNumber(
                      event.target.value,
                    ),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Denne simulering har {fieldCount}{' '}
                {fieldCount === 1 ? 'mark' : 'marker'}.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label>Påkrævede afgrødeandele</Label>
              <p className="text-xs text-muted-foreground">
                Tilføj afgrøder, der mindst skal dække en given procentdel af
                simuleringen.
              </p>
            </div>
            {constraints.cropPercentages.map((constraint, index) => (
              <div key={`${constraint.crop}-${index}`} className="flex gap-2">
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={constraint.crop}
                  onChange={(event) =>
                    updateCropPercentage(index, {
                      crop: event.target.value as Crop,
                    })
                  }
                >
                  {CROP_VALUES.map((crop) => (
                    <option key={crop} value={crop}>
                      {formatCrop(crop)}
                    </option>
                  ))}
                </select>
                <Input
                  className="w-28"
                  type="number"
                  min="0"
                  max="100"
                  value={constraint.minimumPercentage}
                  onChange={(event) =>
                    updateCropPercentage(index, {
                      minimumPercentage: Number(event.target.value),
                    })
                  }
                />
                <Button
                  variant="outline"
                  onClick={() => removeCropPercentage(index)}
                >
                  Fjern
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={addCropPercentage}
              disabled={!getFirstUnusedCrop(constraints)}
            >
              Tilføj afgrødekrav
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
