import {
  ChevronDown,
  ChevronRight,
  Lock,
  LockOpen,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { mutate } from 'swr'

import { farmFieldsKey, simulationFieldsKey, useFarmFields } from '@/api/hooks'
import { detachField, updateSimulationField } from '@/api/mutations'
import type { FieldRecord, Simulation } from '@/api/types'
import type {
  FieldsSortDirection,
  FieldsSortKey,
  FieldsSortState,
} from '@/components/farm/field-list-state'
import type { FarmInspectorMode } from '@/components/farm/types'
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import { RotationDetailPanel } from '@/components/farm/RotationDetailPanel'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  changedFieldIds,
  formatLockTooltip,
  formatRotationYear,
  isFieldLocked,
  ROTATION_START_CALENDAR_YEAR,
} from '@/lib/field-domain'

const numberFormat = new Intl.NumberFormat('da-DK', {
  maximumFractionDigits: 1,
})

const formatNumber = (value: number) => numberFormat.format(value)

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
    case 'db2':
      return compareNumber(left.db2, right.db2, sort.direction)
    case 'nLoad':
      return compareNumber(left.nLoad, right.nLoad, sort.direction)
    case 'leaching':
      return compareNumber(left.leaching, right.leaching, sort.direction)
    case 'fen':
      return compareNumber(left.fen, right.fen, sort.direction)
    case 'udledningskvoteMarkKgn':
      return compareNullableNumber(
        left.udledningskvoteMarkKgn,
        right.udledningskvoteMarkKgn,
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
    case 'jbnr':
      return compareNullableNumber(left.jbnr, right.jbnr, sort.direction)
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
  isSimulationView?: boolean
  simulationId?: string
  simulation?: Simulation
  mode: FarmInspectorMode
  sort: FieldsSortState
  onSortChange: (sort: FieldsSortState) => void
  onSwitchToMap: () => void
  onError: (message: string | null) => void
}

const NOT_YET_AVAILABLE_TITLE =
  "Ikke tilgængelig i det nye optimeringsflow — sædskiftet genereres nu som scenarie-kandidater ved 'Opret scenarie', og Optimér vælger automatisk den bedste blandt dem."

export const FarmFieldsList = ({
  farmId,
  fields,
  isSimulationView = false,
  simulationId,
  simulation,
  mode,
  sort,
  onSortChange,
  onSwitchToMap,
  onError,
}: FarmFieldsListProps) => {
  const [detachingFieldId, setDetachingFieldId] = useState<string | null>(null)
  const [lockingFieldId, setLockingFieldId] = useState<string | null>(null)
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null)
  const [manualEditFieldId, setManualEditFieldId] = useState<string | null>(null)

  const isRules = mode === 'rules'

  const sortedFields = useMemo(
    () => [...fields].sort((left, right) => compareFields(left, right, sort)),
    [fields, sort],
  )

  const maxYears = Math.max(0, ...fields.map((field) => field.cropRotation.length))
  const yearIndexes = Array.from({ length: maxYears }, (_, index) => index)

  const { data: liveFields = [] } = useFarmFields(farmId)
  const changedFields = useMemo(
    () => (isRules ? new Set<string>() : changedFieldIds(fields, liveFields)),
    [isRules, fields, liveFields],
  )

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

  const toggleFieldLock = async (field: FieldRecord) => {
    if (!simulationId || field.rotationId === null) return

    const locked = isFieldLocked(field)
    const target = locked ? [] : [field.rotationId]

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

  const showActions = isRules || !isSimulationView
  const hasDetailColumn = isSimulationView && !isRules
  const valuesColumnCount =
    (hasDetailColumn ? 1 : 0) + 2 + maxYears + 8 + (showActions ? 1 : 0)

  const headBackground = isRules ? 'bg-indigo-100' : 'bg-muted'
  const stickyDetail = 'sticky left-0'
  const stickyName = `sticky ${hasDetailColumn ? 'left-8' : 'left-0'} border-r`
  const pinnedBodyCell = (highlighted: boolean) =>
    `z-10 border-t ${highlighted ? 'bg-blue-50' : 'bg-background'}`

  return (
    <Card
      className={`flex min-h-0 flex-1 flex-col ${isRules ? 'border-indigo-300' : ''}`.trim()}
    >
      <CardHeader
        className={`shrink-0 ${isRules ? 'border-b border-indigo-200' : ''}`.trim()}
      >
        <CardTitle className="flex items-center gap-2">
          {isRules ? (
            <SlidersHorizontal
              className="h-4 w-4 text-indigo-600"
              aria-hidden="true"
            />
          ) : null}
          {isRules ? 'Regler pr. mark' : 'Marker'}
        </CardTitle>
        <CardDescription>
          {isRules
            ? 'Hvad optimeringen må gøre ved hver mark. Ændringer her styrer næste kørsel — de er ikke tal, marken har.'
            : isSimulationView
              ? 'Sædskifte og tal, som optimeringen har beregnet for denne simulering.'
              : 'Marker, der aktuelt er tilknyttet bedriften.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden">
        <div
          className={`h-full overflow-auto rounded-lg border ${isRules ? 'border-indigo-200' : ''}`.trim()}
        >
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead className={`sticky top-0 z-20 ${headBackground}`}>
              <tr>
                {hasDetailColumn ? (
                  <th className={`w-8 px-2 py-3 z-30 ${stickyDetail} ${headBackground}`}>
                    <span className="sr-only">Beregningsdetaljer</span>
                  </th>
                ) : null}
                <SortableHeader
                  label="Mark"
                  sortKey="name"
                  sort={sort}
                  onSortChange={onSortChange}
                  className={`z-30 ${stickyName} ${headBackground}`}
                />
                <SortableHeader
                  label="Areal"
                  sortKey="areaHa"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                {isRules ? (
                  <>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Bundet sædskifte</th>
                    <th className="px-4 py-3 font-medium">
                      Tilladte sædskifter
                    </th>
                  </>
                ) : (
                  <>
                    {yearIndexes.map((index) => (
                      <th key={index} className="px-4 py-3 font-medium">
                        {ROTATION_START_CALENDAR_YEAR + index}
                      </th>
                    ))}
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
                      label="Foderenheder (FE)"
                      sortKey="fen"
                      sort={sort}
                      onSortChange={onSortChange}
                    />
                    <SortableHeader
                      label="Udledningskvote (kg N)"
                      sortKey="udledningskvoteMarkKgn"
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
                      label="JB nr."
                      sortKey="jbnr"
                      sort={sort}
                      onSortChange={onSortChange}
                    />
                  </>
                )}
                {showActions ? (
                  <th className="px-4 py-3 text-right font-medium">
                    Handlinger
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {sortedFields.map((field) => {
                const canEdit = isSimulationView && Boolean(simulationId)
                const highlighted = !isRules && changedFields.has(field.id)
                const isExpanded = expandedFieldId === field.id
                const canShowDetail = isSimulationView && field.rotationId !== null
                const locked = isFieldLocked(field)
                return (
                  <Fragment key={field.id}>
                  <tr className={`border-t ${highlighted ? 'bg-blue-50' : ''}`}>
                    {hasDetailColumn ? (
                      <td
                        className={`px-2 py-3 ${stickyDetail} ${pinnedBodyCell(highlighted)}`}
                      >
                        {canShowDetail ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() =>
                              setExpandedFieldId(isExpanded ? null : field.id)
                            }
                            aria-label={
                              isExpanded
                                ? 'Skjul beregningsdetaljer'
                                : 'Vis beregningsdetaljer'
                            }
                            title="Vis beregningsgennemgang for udvaskning og dækningsbidrag pr. år"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            )}
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                    <td
                      className={`px-4 py-3 font-medium ${stickyName} ${pinnedBodyCell(highlighted)}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {field.name}
                        {locked ? (
                          <span
                            title={formatLockTooltip(field)}
                            className="inline-flex"
                          >
                            <Lock
                              className="h-4.5 w-4.5 shrink-0 text-amber-600"
                              aria-label="Låst mark"
                            />
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {formatNumber(field.areaHa)} ha
                    </td>
                    {isRules ? (
                      <>
                        <td className="px-4 py-3">
                          {locked ? (
                            <span
                              title={formatLockTooltip(field)}
                              className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                            >
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              Låst
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              <LockOpen className="h-3 w-3" aria-hidden="true" />
                              Fri
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {locked && field.cropRotation.length > 0 ? (
                            <span
                              className="block max-w-xs truncate"
                              title={field.cropRotation
                                .map(formatRotationYear)
                                .join(' - ')}
                            >
                              {field.cropRotation
                                .map(formatRotationYear)
                                .join(' - ')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              Optimeringen vælger
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {field.allowedRotationIds.length === 0 ? (
                            <span className="text-muted-foreground">
                              Alle i scenariet
                            </span>
                          ) : (
                            `${field.allowedRotationIds.length} valgt`
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        {yearIndexes.map((index) => {
                          const year = field.cropRotation[index]
                          return (
                            <td key={index} className="px-4 py-3">
                              {year ? formatRotationYear(year) : '—'}
                            </td>
                          )
                        })}
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
                          <div>{formatNumber(field.fen)} FE</div>
                          {field.areaHa > 0 ? (
                            <div className="text-xs text-muted-foreground/80">
                              {formatNumber(field.fen / field.areaHa)} FE/ha
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            {formatNumber(field.udledningskvoteMarkKgn)} kg N
                          </div>
                          <div className="text-xs text-muted-foreground/80">
                            {formatNumber(field.udledningsgraenseKgnHa)} kg N/ha
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {field.inTakeoutPlan ? 'Ja' : 'Nej'}
                        </td>
                        <td className="px-4 py-3">
                          {field.retention === null
                            ? 'Ukendt'
                            : formatNumber(field.retention)}
                        </td>
                        <td className="px-4 py-3">
                          {field.jbnr === null ? 'Ukendt' : field.jbnr}
                        </td>
                      </>
                    )}
                    {showActions ? (
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex flex-nowrap justify-end gap-2">
                          {isRules && canEdit ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={field.rotationId === null}
                                onClick={() => setManualEditFieldId(field.id)}
                                title={
                                  field.rotationId === null
                                    ? 'Kør Optimér for denne mark, før du kan binde et sædskifte.'
                                    : 'Bind marken til et bestemt sædskifte, som optimeringen skal respektere.'
                                }
                              >
                                Fastlås sædskifte
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled
                                title={NOT_YET_AVAILABLE_TITLE}
                              >
                                Tilladte sædskifter
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void toggleFieldLock(field)}
                                disabled={
                                  field.rotationId === null ||
                                  lockingFieldId === field.id
                                }
                                aria-label={locked ? 'Lås op' : 'Lås'}
                                className={
                                  locked
                                    ? 'h-8 w-8 p-0 bg-amber-100 text-amber-700'
                                    : 'h-8 w-8 p-0 text-muted-foreground'
                                }
                                title={
                                  locked
                                    ? 'Marken er låst til det valgte sædskifte — Optimér ændrer den ikke. Klik for at låse op.'
                                    : 'Marken er ikke låst — Optimér kan frit ændre den. Klik for at låse.'
                                }
                              >
                                {locked ? (
                                  <Lock className="h-4 w-4" aria-hidden="true" />
                                ) : (
                                  <LockOpen
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                )}
                              </Button>
                            </>
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
                    ) : null}
                  </tr>
                  {isExpanded && simulationId && !isRules ? (
                    <tr className="border-t">
                      <td colSpan={valuesColumnCount} className="p-0">
                        <RotationDetailPanel
                          farmId={farmId}
                          simulationId={simulationId}
                          fieldId={field.id}
                          rotationId={field.rotationId}
                          areaHa={field.areaHa}
                          retention={field.retention}
                        />
                      </td>
                    </tr>
                  ) : null}
                  {simulationId && simulation ? (
                    <ManualRotationEditor
                      farmId={farmId}
                      simulationId={simulationId}
                      simulation={simulation}
                      field={field}
                      open={manualEditFieldId === field.id}
                      onOpenChange={(nextOpen) =>
                        setManualEditFieldId(nextOpen ? field.id : null)
                      }
                      onError={onError}
                    />
                  ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
