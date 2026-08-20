import { Lock, LockOpen, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { mutate } from 'swr'

import { farmFieldsKey, simulationFieldsKey, useFarmFields } from '@/api/hooks'
import { detachField, updateSimulationField } from '@/api/mutations'
import type {
  Crop,
  FieldMeasures,
  FieldRecord,
  NamedRotation,
  Simulation,
} from '@/api/types'
import type {
  FieldsSortDirection,
  FieldsSortKey,
  FieldsSortState,
} from '@/components/farm/field-list-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CROP_VALUES,
  changedFieldIds,
  cropAllowsCoverCrop,
  cropAllowsEarlySowing,
  formatCrop,
  formatCropRotation,
  formatMeasures,
  formatSoil,
  groupRotationsByCategory,
  measuresEqual,
  normalizeMeasuresForRotation,
} from '@/lib/field-domain'

const formatNumber = (value: number) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 }).format(value)

const rotationsEqual = (left: Crop[], right: Crop[]) =>
  left.length === right.length &&
  left.every((crop, index) => crop === right[index])

const findMatchingRotationId = (
  cropRotation: Crop[],
  rotationLibrary: NamedRotation[],
) =>
  rotationLibrary.find((rotation) =>
    rotationsEqual(rotation.crops, cropRotation),
  )?.id

const collator = new Intl.Collator('da-DK', { sensitivity: 'base' })

const compareNullableNumber = (
  left: number | null,
  right: number | null,
  direction: FieldsSortDirection,
) => {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'asc' ? left - right : right - left
}

const compareNumber = (
  left: number,
  right: number,
  direction: FieldsSortDirection,
) => (direction === 'asc' ? left - right : right - left)

const compareString = (
  left: string,
  right: string,
  direction: FieldsSortDirection,
) => {
  const result = collator.compare(left, right)
  return direction === 'asc' ? result : -result
}

const comparePrimary = (
  left: FieldRecord,
  right: FieldRecord,
  sort: FieldsSortState,
) => {
  switch (sort.key) {
    case 'name':
      return compareString(left.name, right.name, sort.direction)
    case 'areaHa':
      return compareNumber(left.areaHa, right.areaHa, sort.direction)
    case 'cropRotation':
      return compareString(
        left.cropRotation.join('|'),
        right.cropRotation.join('|'),
        sort.direction,
      )
    case 'db2':
      return compareNumber(left.db2, right.db2, sort.direction)
    case 'nLoad':
      return compareNumber(left.nLoad, right.nLoad, sort.direction)
    case 'leaching':
      return compareNumber(left.leaching, right.leaching, sort.direction)
    case 'nQuotaKgN':
      return compareNullableNumber(
        left.nQuotaKgN,
        right.nQuotaKgN,
        sort.direction,
      )
    case 'inTakeoutPlan':
      return compareNumber(
        Number(left.inTakeoutPlan),
        Number(right.inTakeoutPlan),
        sort.direction,
      )
    case 'retention':
      return compareNullableNumber(
        left.retention,
        right.retention,
        sort.direction,
      )
    case 'soil':
      return compareString(left.soil, right.soil, sort.direction)
  }
}

const compareFields = (
  left: FieldRecord,
  right: FieldRecord,
  sort: FieldsSortState,
) => {
  const primary = comparePrimary(left, right, sort)
  if (primary !== 0) return primary
  const imkTie = compareNullableNumber(left.imkId, right.imkId, 'asc')
  if (imkTie !== 0) return imkTie
  return compareString(left.id, right.id, 'asc')
}

type SortableHeaderProps = {
  label: string
  sortKey: FieldsSortKey
  sort: FieldsSortState
  onSortChange: (sort: FieldsSortState) => void
  className?: string
  align?: 'left' | 'right'
}

const SortableHeader = ({
  label,
  sortKey,
  sort,
  onSortChange,
  className,
  align = 'left',
}: SortableHeaderProps) => {
  const isActive = sort.key === sortKey
  const ariaSort = isActive
    ? sort.direction === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
  const glyph = isActive ? (sort.direction === 'asc' ? '▲' : '▼') : ''
  const handleClick = () => {
    if (isActive) {
      onSortChange({
        key: sortKey,
        direction: sort.direction === 'asc' ? 'desc' : 'asc',
      })
    } else {
      onSortChange({ key: sortKey, direction: 'asc' })
    }
  }

  return (
    <th
      aria-sort={ariaSort}
      className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : ''} ${className ?? ''}`.trim()}
    >
      <button
        type="button"
        onClick={handleClick}
        className={`-mx-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted/70 ${align === 'right' ? 'justify-end' : ''}`}
      >
        <span>{label}</span>
        {glyph ? (
          <span aria-hidden="true" className="text-xs text-muted-foreground">
            {glyph}
          </span>
        ) : null}
      </button>
    </th>
  )
}

type FarmFieldsListProps = {
  farmId: string
  fields: FieldRecord[]
  rotationLibrary: NamedRotation[]
  initialCropRotations?: Record<string, Crop[]>
  isSimulationView?: boolean
  simulationId?: string
  simulation?: Simulation
  sort: FieldsSortState
  onSortChange: (sort: FieldsSortState) => void
  onSwitchToMap: () => void
  onError: (message: string | null) => void
}

export const FarmFieldsList = ({
  farmId,
  fields,
  rotationLibrary,
  initialCropRotations,
  isSimulationView = false,
  simulationId,
  simulation,
  sort,
  onSortChange,
  onSwitchToMap,
  onError,
}: FarmFieldsListProps) => {
  const [detachingFieldId, setDetachingFieldId] = useState<string | null>(null)
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null)
  const [lockingFieldId, setLockingFieldId] = useState<string | null>(null)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [allowedRotationsField, setAllowedRotationsField] =
    useState<FieldRecord | null>(null)
  const [manualRotationField, setManualRotationField] =
    useState<FieldRecord | null>(null)
  const [initialRotations, setInitialRotations] = useState<
    Record<string, Crop[]>
  >(() =>
    Object.fromEntries(fields.map((field) => [field.id, field.cropRotation])),
  )

  const getInitialRotation = (field: FieldRecord) =>
    initialCropRotations?.[field.id] ??
    initialRotations[field.id] ??
    field.cropRotation

  const sortedFields = useMemo(
    () => [...fields].sort((left, right) => compareFields(left, right, sort)),
    [fields, sort],
  )

  const { data: liveFields = [] } = useFarmFields(farmId)
  const changedFields = useMemo(
    () => changedFieldIds(fields, liveFields),
    [fields, liveFields],
  )

  const ensureInitialRotation = (field: FieldRecord) => {
    if (initialRotations[field.id]) return

    setInitialRotations((current) => ({
      ...current,
      [field.id]: field.cropRotation,
    }))
  }

  const detachFarmField = async (fieldId: string) => {
    setDetachingFieldId(fieldId)
    try {
      await detachField(farmId, fieldId)
      await mutate(farmFieldsKey(farmId))
      onError(null)
    } catch {
      onError('Kunne ikke fjerne marken fra bedriften.')
    } finally {
      setDetachingFieldId(null)
    }
  }

  const getRotationChoice = (field: FieldRecord) => {
    if (rotationsEqual(field.cropRotation, getInitialRotation(field))) {
      return 'current'
    }

    return (
      findMatchingRotationId(field.cropRotation, rotationLibrary) ?? 'custom'
    )
  }

  const applyRotationChoice = async (field: FieldRecord, choice: string) => {
    if (!simulationId) return
    if (choice === 'custom') return
    ensureInitialRotation(field)

    const selectedRotation =
      choice === 'current'
        ? getInitialRotation(field)
        : rotationLibrary.find((rotation) => rotation.id === choice)?.crops

    if (
      !selectedRotation ||
      rotationsEqual(selectedRotation, field.cropRotation)
    ) {
      return
    }

    setSavingFieldId(field.id)
    try {
      const updatedField = await updateSimulationField(
        farmId,
        simulationId,
        field.id,
        {
          cropRotation: selectedRotation,
        },
      )
      await mutate(
        simulationFieldsKey(farmId, simulationId),
        (current: FieldRecord[] = []) =>
          current.map((currentField) =>
            currentField.id === updatedField.id ? updatedField : currentField,
          ),
        { revalidate: false },
      )
      onError(null)
    } catch {
      onError('Kunne ikke opdatere sædskiftet.')
    } finally {
      setSavingFieldId(null)
    }
  }

  const isFieldLocked = (field: FieldRecord) =>
    field.allowedRotationIds.length === 1 &&
    field.allowedRotationIds[0] === 'current'

  const toggleFieldLock = async (field: FieldRecord) => {
    if (!simulationId) return

    const locked = isFieldLocked(field)
    const globalIds =
      simulation?.constraints.globallyAllowedRotationIds ??
      rotationLibrary.map((rotation) => rotation.id)
    const unlockedIds = Array.from(new Set(['current', ...globalIds]))
    const target = locked ? unlockedIds : ['current']

    setLockingFieldId(field.id)
    try {
      const updatedField = await updateSimulationField(
        farmId,
        simulationId,
        field.id,
        { allowedRotationIds: target },
      )
      await mutate(
        simulationFieldsKey(farmId, simulationId),
        (current: FieldRecord[] = []) =>
          current.map((currentField) =>
            currentField.id === updatedField.id ? updatedField : currentField,
          ),
        { revalidate: false },
      )
      onError(null)
    } catch {
      onError('Kunne ikke ændre låsningen af marken.')
    } finally {
      setLockingFieldId(null)
    }
  }

  if (fields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tilføj marker fra kortet</CardTitle>
          <CardDescription>
            {isSimulationView
              ? 'Denne simulering blev oprettet, før der var tilknyttet aktuelle marker.'
              : 'Skift til kortvisning og slå Tilføj marker til for at gennemgå registermarker, før du tilføjer dem.'}
          </CardDescription>
        </CardHeader>
        {!isSimulationView ? (
          <CardContent>
            <Button onClick={onSwitchToMap}>Åbn kortvisning</Button>
          </CardContent>
        ) : null}
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Marker</CardTitle>
        <CardDescription>
          {isSimulationView
            ? 'Marker kopieret ind i denne simulering.'
            : 'Marker, der aktuelt er tilknyttet bedriften.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/60">
              <tr>
                <SortableHeader
                  label="Mark"
                  sortKey="name"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="Areal"
                  sortKey="areaHa"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="Sædskifte"
                  sortKey="cropRotation"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="DB2 (kr)"
                  sortKey="db2"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="Kvælstofudledning (kg N)"
                  sortKey="nLoad"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="Udvaskning (kg N)"
                  sortKey="leaching"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="Kvælstofkvote (kg N)"
                  sortKey="nQuotaKgN"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="I omlægningsplan"
                  sortKey="inTakeoutPlan"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="Retention"
                  sortKey="retention"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <SortableHeader
                  label="Jordtype"
                  sortKey="soil"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <th className="px-4 py-3 text-right font-medium">Handlinger</th>
              </tr>
            </thead>
            <tbody>
              {sortedFields.map((field) => {
                const isEditing = editingFieldId === field.id
                const canEdit = isSimulationView && Boolean(simulationId)
                const isChanged = changedFields.has(field.id)
                return (
                  <tr
                    key={field.id}
                    className={`border-t ${isChanged ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium">{field.name}</td>
                    <td className="px-4 py-3">
                      {formatNumber(field.areaHa)} ha
                    </td>
                    <td className="px-4 py-3">
                      {isEditing && canEdit ? (
                        <div className="min-w-48 space-y-2">
                          <p>{formatCropRotation(field.cropRotation)}</p>
                          <select
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                            value={getRotationChoice(field)}
                            onChange={(event) =>
                              void applyRotationChoice(
                                field,
                                event.target.value,
                              )
                            }
                            disabled={
                              !simulationId || savingFieldId === field.id
                            }
                          >
                            <option value="current">Aktuel</option>
                            {rotationLibrary.map((rotation) => (
                              <option key={rotation.id} value={rotation.id}>
                                {rotation.name}
                              </option>
                            ))}
                            <option value="custom" disabled>
                              Tilpasset
                            </option>
                          </select>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                ensureInitialRotation(field)
                                setManualRotationField(field)
                              }}
                            >
                              Rediger manuelt
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAllowedRotationsField(field)}
                            >
                              Tilladte sædskifter
                            </Button>
                          </div>
                          {savingFieldId === field.id ? (
                            <p className="text-xs text-muted-foreground">
                              Gemmer...
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div>{formatCropRotation(field.cropRotation)}</div>
                          {isSimulationView ? (
                            <div className="text-xs text-muted-foreground">
                              Virkemidler: {formatMeasures(field.measures)}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>{formatNumber(field.db2)} kr</div>
                      {field.areaHa > 0 ? (
                        <div className="text-xs text-muted-foreground/80">
                          {formatNumber(field.db2 / field.areaHa)} kr/ha
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div>{formatNumber(field.nLoad)} kg N</div>
                      {field.areaHa > 0 ? (
                        <div className="text-xs text-muted-foreground/80">
                          {formatNumber(field.nLoad / field.areaHa)} kg N/ha
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div>{formatNumber(field.leaching)} kg N</div>
                      {field.areaHa > 0 ? (
                        <div className="text-xs text-muted-foreground/80">
                          {formatNumber(field.leaching / field.areaHa)} kg N/ha
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        {field.nQuotaKgN === null
                          ? 'Ukendt'
                          : `${formatNumber(field.nQuotaKgN)} kg N`}
                      </div>
                      {field.nQuotaKgN !== null && field.areaHa > 0 ? (
                        <div className="text-xs text-muted-foreground/80">
                          {formatNumber(field.nQuotaKgN / field.areaHa)} kg N/ha
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {field.inTakeoutPlan ? 'Ja' : 'Nej'}
                    </td>
                    <td className="px-4 py-3">
                      {field.retention === null
                        ? 'Ukendt'
                        : formatNumber(field.retention)}
                    </td>
                    <td className="px-4 py-3">{formatSoil(field.soil)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex flex-nowrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant={isEditing ? 'default' : 'outline'}
                          onClick={() =>
                            setEditingFieldId(isEditing ? null : field.id)
                          }
                          disabled={!canEdit && !isEditing}
                          title={
                            canEdit
                              ? undefined
                              : 'Opret en simulering for at redigere sædskifter.'
                          }
                        >
                          {isEditing ? 'Færdig' : 'Rediger'}
                        </Button>
                        {canEdit ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void toggleFieldLock(field)}
                            disabled={lockingFieldId === field.id}
                            aria-label={isFieldLocked(field) ? 'Lås op' : 'Lås'}
                            className={
                              isFieldLocked(field)
                                ? 'h-8 w-8 p-0 bg-amber-100 text-amber-700 hover:bg-amber-200 hover:text-amber-800'
                                : 'h-8 w-8 p-0 text-muted-foreground hover:bg-muted hover:text-foreground'
                            }
                            title={
                              isFieldLocked(field)
                                ? 'Marken er låst. Klik for at låse op.'
                                : 'Marken er ikke låst. Klik for at låse.'
                            }
                          >
                            {isFieldLocked(field) ? (
                              <Lock className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <LockOpen
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            )}
                          </Button>
                        ) : null}
                        {!isSimulationView ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void detachFarmField(field.id)}
                            disabled={detachingFieldId === field.id}
                            aria-label="Fjern"
                            className="h-8 w-8 p-0 text-muted-foreground hover:bg-red-50 hover:text-red-700"
                            title={
                              detachingFieldId === field.id
                                ? 'Fjerner...'
                                : 'Fjern marken fra bedriften.'
                            }
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {allowedRotationsField && simulationId ? (
          <AllowedRotationsDialog
            key={allowedRotationsField.id}
            farmId={farmId}
            simulationId={simulationId}
            field={allowedRotationsField}
            rotationLibrary={rotationLibrary}
            open={allowedRotationsField !== null}
            onOpenChange={(open) => {
              if (!open) setAllowedRotationsField(null)
            }}
            onError={onError}
          />
        ) : null}
        {manualRotationField && simulationId ? (
          <ManualRotationDialog
            key={manualRotationField.id}
            farmId={farmId}
            simulationId={simulationId}
            field={manualRotationField}
            open={manualRotationField !== null}
            onOpenChange={(open) => {
              if (!open) setManualRotationField(null)
            }}
            onError={onError}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

type AllowedRotationsDialogProps = {
  farmId: string
  simulationId: string
  field: FieldRecord
  rotationLibrary: NamedRotation[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}

type ManualRotationDialogProps = {
  farmId: string
  simulationId: string
  field: FieldRecord
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}

const toggleRotationId = (ids: string[], id: string, checked: boolean) => {
  if (checked) return ids.includes(id) ? ids : [...ids, id]

  return ids.filter((rotationId) => rotationId !== id)
}

const ManualRotationDialog = ({
  farmId,
  simulationId,
  field,
  open,
  onOpenChange,
  onError,
}: ManualRotationDialogProps) => {
  const [cropRotation, setCropRotation] = useState(field.cropRotation)
  const [measures, setMeasures] = useState<FieldMeasures>(field.measures)
  const [isSaving, setIsSaving] = useState(false)
  const hasChanged =
    !rotationsEqual(cropRotation, field.cropRotation) ||
    !measuresEqual(measures, field.measures)

  const updateCropRotation = (nextRotation: Crop[]) => {
    setCropRotation(nextRotation)
    setMeasures((current) =>
      normalizeMeasuresForRotation(current, nextRotation),
    )
  }

  const toggleMeasureYear = (
    key: 'coverCropYears' | 'earlySowingYears',
    year: number,
    checked: boolean,
  ) => {
    setMeasures((current) => {
      const years = checked
        ? Array.from(new Set([...current[key], year])).sort((a, b) => a - b)
        : current[key].filter((currentYear) => currentYear !== year)
      return { ...current, [key]: years }
    })
  }

  const saveCropRotation = async () => {
    if (cropRotation.length === 0) {
      onError('Sædskiftet skal indeholde mindst én afgrøde.')
      return
    }

    setIsSaving(true)
    try {
      const updatedField = await updateSimulationField(
        farmId,
        simulationId,
        field.id,
        {
          cropRotation,
          measures: normalizeMeasuresForRotation(measures, cropRotation),
        },
      )
      await mutate(
        simulationFieldsKey(farmId, simulationId),
        (current: FieldRecord[] = []) =>
          current.map((currentField) =>
            currentField.id === updatedField.id ? updatedField : currentField,
          ),
        { revalidate: false },
      )
      onOpenChange(false)
      onError(null)
    } catch {
      onError('Kunne ikke opdatere sædskiftet.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Rediger sædskifte og virkemidler for {field.name}
          </DialogTitle>
          <DialogDescription>
            Tilpas sædskiftet og de valgte virkemidler manuelt år for år.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <label className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={measures.precisionFarming}
              onChange={(event) =>
                setMeasures((current) => ({
                  ...current,
                  precisionFarming: event.target.checked,
                }))
              }
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                Præcisionslandbrug
              </span>
              <span className="block text-xs text-muted-foreground">
                Reducerer kvælstofudledning med 4% for hele marken.
              </span>
            </span>
          </label>

          {cropRotation.map((crop, cropIndex) => {
            const coverCropAllowed = cropAllowsCoverCrop(
              cropRotation,
              cropIndex,
            )
            const earlySowingAllowed = cropAllowsEarlySowing(crop)
            return (
              <div key={cropIndex} className="space-y-2 rounded-md border p-3">
                <div className="flex gap-2">
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    value={crop}
                    onChange={(event) => {
                      const nextRotation = [...cropRotation]
                      nextRotation[cropIndex] = event.target.value as Crop
                      updateCropRotation(nextRotation)
                    }}
                  >
                    {CROP_VALUES.map((cropValue) => (
                      <option key={cropValue} value={cropValue}>
                        {formatCrop(cropValue)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateCropRotation(
                        cropRotation.filter((_, index) => index !== cropIndex),
                      )
                    }
                    disabled={cropRotation.length === 1}
                  >
                    Fjern
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={measures.coverCropYears.includes(cropIndex)}
                      disabled={!coverCropAllowed}
                      onChange={(event) =>
                        toggleMeasureYear(
                          'coverCropYears',
                          cropIndex,
                          event.target.checked,
                        )
                      }
                    />
                    <span>
                      Efterafgrøde
                      {!coverCropAllowed ? (
                        <span className="block text-xs text-muted-foreground">
                          Ikke før vintersæd.
                        </span>
                      ) : null}
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={measures.earlySowingYears.includes(cropIndex)}
                      disabled={!earlySowingAllowed}
                      onChange={(event) =>
                        toggleMeasureYear(
                          'earlySowingYears',
                          cropIndex,
                          event.target.checked,
                        )
                      }
                    />
                    <span>
                      Tidlig såning
                      {!earlySowingAllowed ? (
                        <span className="block text-xs text-muted-foreground">
                          Kun vintersæd.
                        </span>
                      ) : null}
                    </span>
                  </label>
                </div>
              </div>
            )
          })}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              updateCropRotation([...cropRotation, 'CEREAL_WINTER'])
            }
          >
            Tilføj afgrøde
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuller
          </Button>
          <Button
            onClick={() => void saveCropRotation()}
            disabled={isSaving || cropRotation.length === 0 || !hasChanged}
          >
            {isSaving ? 'Gemmer...' : 'Gem'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const AllowedRotationsDialog = ({
  farmId,
  simulationId,
  field,
  rotationLibrary,
  open,
  onOpenChange,
  onError,
}: AllowedRotationsDialogProps) => {
  const [allowedRotationIds, setAllowedRotationIds] = useState(
    field.allowedRotationIds,
  )
  const [isSaving, setIsSaving] = useState(false)

  const saveAllowedRotations = async () => {
    if (allowedRotationIds.length === 0) {
      onError('Mindst ét sædskifte skal være tilladt.')
      return
    }

    setIsSaving(true)
    try {
      const updatedField = await updateSimulationField(
        farmId,
        simulationId,
        field.id,
        { allowedRotationIds },
      )
      await mutate(
        simulationFieldsKey(farmId, simulationId),
        (current: FieldRecord[] = []) =>
          current.map((currentField) =>
            currentField.id === updatedField.id ? updatedField : currentField,
          ),
        { revalidate: false },
      )
      onOpenChange(false)
      onError(null)
    } catch {
      onError('Kunne ikke opdatere tilladte sædskifter.')
    } finally {
      setIsSaving(false)
    }
  }

  const categoryGroups = groupRotationsByCategory(rotationLibrary)

  const toggleCategoryRotations = (ids: string[], checked: boolean) => {
    setAllowedRotationIds((current) => {
      if (checked) {
        const next = new Set(current)
        for (const id of ids) next.add(id)
        return Array.from(next)
      }
      const removal = new Set(ids)
      return current.filter((id) => !removal.has(id))
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tilladte sædskifter for {field.name}</DialogTitle>
          <DialogDescription>
            Vælg de sædskifter, som marken må bruge under optimering.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() =>
              setAllowedRotationIds([
                'current',
                ...rotationLibrary.map((rotation) => rotation.id),
              ])
            }
          >
            Vælg alle
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => setAllowedRotationIds([])}
          >
            Fravælg alle
          </Button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <label className="flex gap-3 rounded-md border p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={allowedRotationIds.includes('current')}
              onChange={(event) =>
                setAllowedRotationIds((current) =>
                  toggleRotationId(current, 'current', event.target.checked),
                )
              }
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                Aktuelt sædskifte
              </span>
              <span className="block text-xs text-muted-foreground">
                {formatCropRotation(field.cropRotation)}
              </span>
            </span>
          </label>

          {categoryGroups.map((group) => {
            const ids = group.rotations.map((rotation) => rotation.id)
            const selectedCount = ids.filter((id) =>
              allowedRotationIds.includes(id),
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
                      toggleCategoryRotations(ids, event.target.checked)
                    }
                  />
                  <span>{group.category}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {selectedCount}/{ids.length}
                  </span>
                </label>
                {group.rotations.map((rotation) => (
                  <label
                    key={rotation.id}
                    className="flex gap-3 rounded-md border p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={allowedRotationIds.includes(rotation.id)}
                      onChange={(event) =>
                        setAllowedRotationIds((current) =>
                          toggleRotationId(
                            current,
                            rotation.id,
                            event.target.checked,
                          ),
                        )
                      }
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
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuller
          </Button>
          <Button
            onClick={() => void saveAllowedRotations()}
            disabled={isSaving || allowedRotationIds.length === 0}
          >
            {isSaving ? 'Gemmer...' : 'Gem tilladte sædskifter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
