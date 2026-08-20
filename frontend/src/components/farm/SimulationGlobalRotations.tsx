import { useRef, useState } from 'react'
import { mutate } from 'swr'

import { simulationFieldsKey, simulationsKey, useFarmFields } from '@/api/hooks'
import {
  updateSimulationConstraints,
  updateSimulationField,
} from '@/api/mutations'
import type {
  Crop,
  FieldRecord,
  NamedRotation,
  Simulation,
} from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatCropRotation, groupRotationsByCategory } from '@/lib/field-domain'

type SimulationGlobalRotationsProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  rotationLibrary: NamedRotation[]
  onError: (message: string | null) => void
}

const rotationsEqual = (left: Crop[], right: Crop[]) =>
  left.length === right.length &&
  left.every((crop, index) => crop === right[index])

export const SimulationGlobalRotations = ({
  farmId,
  simulation,
  fields,
  rotationLibrary,
  onError,
}: SimulationGlobalRotationsProps) => {
  const simulationId = simulation.id
  const savedSelection = simulation.constraints.globallyAllowedRotationIds
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () =>
      savedSelection === null
        ? new Set(rotationLibrary.map((rotation) => rotation.id))
        : new Set(savedSelection),
  )
  const [isApplying, setIsApplying] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const { data: farmFields } = useFarmFields(farmId)

  // Capture the simulation-mount rotations once. Used as a safety fallback
  // when no matching farm field exists (e.g. manual fields without imkId
  // or a farm field deleted after the simulation was created).
  const mountBaselineRotations = useRef<Record<string, Crop[]>>(
    Object.fromEntries(fields.map((field) => [field.id, field.cropRotation])),
  )

  if (rotationLibrary.length === 0) return null

  const allowedCount = checkedIds.size
  const totalCount = rotationLibrary.length
  const farmFieldsLoaded = farmFields !== undefined

  const toggle = (id: string, checked: boolean) => {
    setStatusMessage(null)
    setCheckedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleCategory = (ids: string[], checked: boolean) => {
    setStatusMessage(null)
    setCheckedIds((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const categoryGroups = groupRotationsByCategory(rotationLibrary)

  const applyToAll = async () => {
    if (fields.length === 0) return
    if (!farmFieldsLoaded) return

    const farmRotationsByImk = new Map<number, Crop[]>(
      (farmFields ?? [])
        .filter(
          (field): field is FieldRecord & { imkId: number } =>
            field.imkId !== null,
        )
        .map((field) => [field.imkId, field.cropRotation]),
    )

    const checkedIdsArray = Array.from(checkedIds)
    const allowedRotationIds = ['current', ...checkedIdsArray]
    const allowedLibraryRotations = rotationLibrary.filter((rotation) =>
      checkedIds.has(rotation.id),
    )

    const isRotationAllowed = (rotation: Crop[]) =>
      allowedLibraryRotations.some((libraryRotation) =>
        rotationsEqual(libraryRotation.crops, rotation),
      )

    setIsApplying(true)
    setStatusMessage(null)
    try {
      // Persist the saved selection on the simulation first so that even a
      // partial per-field fan-out failure leaves the saved state matching
      // the user's intent.
      const updatedSimulation = await updateSimulationConstraints(
        farmId,
        simulationId,
        {
          ...simulation.constraints,
          globallyAllowedRotationIds: checkedIdsArray,
        },
      )
      await mutate(
        simulationsKey(farmId),
        (current: Simulation[] = []) =>
          current.map((entry) =>
            entry.id === updatedSimulation.id ? updatedSimulation : entry,
          ),
        { revalidate: false },
      )

      const results = await Promise.all(
        fields.map(async (field) => {
          const farmRotation =
            field.imkId !== null
              ? farmRotationsByImk.get(field.imkId)
              : undefined
          const fallbackBaseline =
            mountBaselineRotations.current[field.id] ?? field.cropRotation
          const resetTarget = farmRotation ?? fallbackBaseline

          const needsRotationReset =
            !isRotationAllowed(field.cropRotation) &&
            !rotationsEqual(field.cropRotation, resetTarget)

          await updateSimulationField(farmId, simulationId, field.id, {
            allowedRotationIds,
            ...(needsRotationReset ? { cropRotation: resetTarget } : {}),
          })

          return needsRotationReset ? 1 : 0
        }),
      )
      await mutate(simulationFieldsKey(farmId, simulationId))
      onError(null)
      const resetCount = results.reduce<number>((sum, value) => sum + value, 0)
      const baseMessage = `Opdaterede ${fields.length} ${fields.length === 1 ? 'mark' : 'marker'}.`
      const resetSuffix =
        resetCount > 0
          ? ` ${resetCount} ${resetCount === 1 ? 'mark' : 'marker'} blev nulstillet til oprindeligt sædskifte.`
          : ''
      setStatusMessage(`${baseMessage}${resetSuffix}`)
    } catch {
      onError('Kunne ikke opdatere de tilladte sædskifter for alle marker.')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className="w-full text-left"
        aria-expanded={isExpanded}
      >
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle>Tilladte sædskifter for alle marker</CardTitle>
            <p className="text-xs text-muted-foreground">
              {allowedCount} af {totalCount}{' '}
              {totalCount === 1 ? 'sædskifte' : 'sædskifter'} tilladt
            </p>
          </div>
          <span
            aria-hidden="true"
            className="mt-1 text-sm text-muted-foreground"
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        </CardHeader>
      </button>
      {isExpanded ? (
        <CardContent className="space-y-4">
          <CardDescription>
            Slå sædskifter til eller fra for alle marker i simuleringen.
            Individuelle marker kan stadig tilpasses bagefter. Det aktuelle
            sædskifte er altid tilladt på globalt niveau.
          </CardDescription>
          <div className="space-y-4">
            {categoryGroups.map((group) => {
              const ids = group.rotations.map((rotation) => rotation.id)
              const selectedCount = ids.filter((id) =>
                checkedIds.has(id),
              ).length
              const allSelected = selectedCount === ids.length
              const partiallySelected = selectedCount > 0 && !allSelected
              return (
                <div key={group.category} className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      ref={(element) => {
                        if (element) element.indeterminate = partiallySelected
                      }}
                      checked={allSelected}
                      onChange={(event) =>
                        toggleCategory(ids, event.target.checked)
                      }
                      disabled={isApplying}
                    />
                    <span>{group.category}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {selectedCount}/{ids.length}
                    </span>
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.rotations.map((rotation) => (
                      <label
                        key={rotation.id}
                        className="flex items-start gap-3 rounded-md border bg-background p-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checkedIds.has(rotation.id)}
                          onChange={(event) =>
                            toggle(rotation.id, event.target.checked)
                          }
                          disabled={isApplying}
                        />
                        <span className="space-y-1">
                          <span className="block text-sm font-medium">
                            {rotation.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatCropRotation(rotation.crops)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void applyToAll()}
              disabled={
                isApplying || fields.length === 0 || !farmFieldsLoaded
              }
            >
              {isApplying ? 'Opdaterer...' : 'Anvend på alle marker'}
            </Button>
            {!farmFieldsLoaded ? (
              <p className="text-sm text-muted-foreground">
                Indlæser oprindelige sædskifter...
              </p>
            ) : null}
            {statusMessage ? (
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            ) : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}
