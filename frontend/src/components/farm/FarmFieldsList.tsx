import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type OnChangeFn,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { Columns3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { mutate } from 'swr'

import { farmFieldsKey, simulationFieldsKey, useFarmFields } from '@/api/hooks'
import { detachField, updateSimulationField } from '@/api/mutations'
import type { FieldRecord, Simulation } from '@/api/types'
import {
  DEFAULT_FIELDS_SORT,
  type FieldsSortKey,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import {
  buildFarmFieldsColumns,
  OPTIONAL_COLUMN_IDS,
} from '@/components/farm/farm-fields-columns'
import { MarkPanel } from '@/components/farm/MarkPanel'
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  buildCropColorMap,
  changedFieldIds,
  isFieldCalculated,
  resolveFarmQuota,
} from '@/lib/field-domain'
import { compareFields } from '@/lib/field-sort'
import { cn } from '@/lib/utils'

const SIMULATION_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'db2',
  'quotaStatus',
])
const CURRENT_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'udledningskvoteMarkKgn',
  'soilSummary',
])

const buildDefaultColumnVisibility = (isSimulationView: boolean): VisibilityState => {
  const visible = isSimulationView
    ? SIMULATION_DEFAULT_VISIBLE_COLUMNS
    : CURRENT_DEFAULT_VISIBLE_COLUMNS
  return Object.fromEntries(
    OPTIONAL_COLUMN_IDS.map((id) => [id, visible.has(id)]),
  )
}

type FarmFieldsListProps = {
  farmId: string
  fields: FieldRecord[]
  isSimulationView?: boolean
  farmQuotaKgN: number
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
  isSimulationView = false,
  farmQuotaKgN,
  simulationId,
  simulation,
  sort,
  onSortChange,
  onSwitchToMap,
  onError,
}: FarmFieldsListProps) => {
  const [detachingFieldId, setDetachingFieldId] = useState<string | null>(null)
  const [lockingFieldId, setLockingFieldId] = useState<string | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [confirmDetachField, setConfirmDetachField] =
    useState<FieldRecord | null>(null)

  const sortedFields = useMemo(
    () => [...fields].sort((left, right) => compareFields(left, right, sort)),
    [fields, sort],
  )

  const selectedField =
    fields.find((field) => field.id === selectedFieldId) ?? null

  const maxYears = Math.max(
    0,
    ...fields.map((field) => field.cropRotation.length),
  )

  const { data: liveFields = [] } = useFarmFields(farmId)
  const changedFields = useMemo(
    () => changedFieldIds(fields, liveFields),
    [fields, liveFields],
  )

  const totals = useMemo(() => {
    const calculatedFields = fields.filter((field) =>
      isFieldCalculated(field, isSimulationView),
    )
    return {
      areaHa: fields.reduce((sum, field) => sum + field.areaHa, 0),
      db2: calculatedFields.reduce((sum, field) => sum + field.db2, 0),
      nLoad: calculatedFields.reduce((sum, field) => sum + field.nLoad, 0),
      leaching: calculatedFields.reduce(
        (sum, field) => sum + field.leaching,
        0,
      ),
      fen: calculatedFields.reduce((sum, field) => sum + field.fen, 0),
      udledningskvoteMarkKgn: fields.reduce(
        (sum, field) => sum + field.udledningskvoteMarkKgn,
        0,
      ),
      calculatedCount: calculatedFields.length,
      uncalculatedCount: fields.length - calculatedFields.length,
    }
  }, [fields, isSimulationView])

  const resolvedQuota = useMemo(
    () => resolveFarmQuota(farmQuotaKgN, totals.udledningskvoteMarkKgn),
    [farmQuotaKgN, totals.udledningskvoteMarkKgn],
  )

  const cropColorMap = useMemo(() => buildCropColorMap(fields), [fields])

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => buildDefaultColumnVisibility(isSimulationView),
  )
  useEffect(() => {
    const nextVisibility = buildDefaultColumnVisibility(isSimulationView)
    setColumnVisibility(nextVisibility)
    if (OPTIONAL_COLUMN_IDS.includes(sort.key) && !nextVisibility[sort.key]) {
      onSortChange(DEFAULT_FIELDS_SORT)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimulationView])

  useEffect(() => {
    setSelectedFieldId(null)
  }, [isSimulationView])

  const detachFarmField = useCallback(
    async (fieldId: string) => {
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
    },
    [farmId, onError],
  )

  const isFieldLocked = useCallback(
    (field: FieldRecord) =>
      field.allowedRotationIds.length === 1 &&
      field.rotationId !== null &&
      field.allowedRotationIds[0] === field.rotationId,
    [],
  )

  const toggleFieldLock = useCallback(
    async (field: FieldRecord) => {
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
    },
    [farmId, simulationId, isFieldLocked, onError],
  )

  const columns = useMemo(
    () =>
      buildFarmFieldsColumns({
        isSimulationView,
        maxYears,
        fields,
        cropColorMap,
        totals,
        resolvedQuota,
        isFieldLocked,
      }),
    [isSimulationView, maxYears, fields, cropColorMap, totals, resolvedQuota, isFieldLocked],
  )

  const sorting: SortingState = useMemo(
    () => [{ id: sort.key, desc: sort.direction === 'desc' }],
    [sort],
  )

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater
    const nextSort = next[0]
    if (!nextSort) return
    onSortChange({
      key: nextSort.id as FieldsSortKey,
      direction: nextSort.desc ? 'desc' : 'asc',
    })
  }

  const table = useReactTable({
    data: sortedFields,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: setColumnVisibility,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const optionalColumns = table
    .getAllLeafColumns()
    .filter((column) => column.columnDef.meta?.toggleLabel !== undefined)
  const visibleOptionalCount = optionalColumns.filter((column) =>
    column.getIsVisible(),
  ).length

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
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Marker</CardTitle>
            <CardDescription>
              {isSimulationView
                ? 'Marker kopieret ind i denne simulering.'
                : 'Marker, der aktuelt er tilknyttet bedriften.'}
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
                Kolonner
                <span className="text-muted-foreground">
                  {visibleOptionalCount} af {optionalColumns.length}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {optionalColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => {
                    column.toggleVisibility(Boolean(checked))
                    if (!checked && column.id === sort.key) {
                      onSortChange(DEFAULT_FIELDS_SORT)
                    }
                  }}
                >
                  {column.columnDef.meta?.toggleLabel ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table className="border-collapse text-left">
              <TableHeader className="bg-muted/60">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const meta = header.column.columnDef.meta
                      const sortable = header.column.getCanSort()
                      const sorted = header.column.getIsSorted()
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            sortable
                              ? sorted === 'asc'
                                ? 'ascending'
                                : sorted === 'desc'
                                  ? 'descending'
                                  : 'none'
                              : undefined
                          }
                          className={meta?.headerClassName}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => {
                  const field = row.original
                  const isChanged = changedFields.has(field.id)
                  const isSelected = selectedFieldId === field.id
                  const openPanel = () =>
                    setSelectedFieldId(isSelected ? null : field.id)
                  return (
                    <TableRow
                      key={field.id}
                      onClick={openPanel}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        openPanel()
                      }}
                      tabIndex={0}
                      aria-label={`Vis detaljer for mark ${field.name}`}
                      data-selected={isSelected}
                      className={cn(
                        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                        isSelected
                          ? 'bg-[#f4f7ef]'
                          : isChanged
                            ? 'bg-blue-50'
                            : undefined,
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta
                        return (
                          <TableCell
                            key={cell.id}
                            className={meta?.cellClassName}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                {table.getFooterGroups().map((footerGroup) => (
                  <TableRow key={footerGroup.id}>
                    {footerGroup.headers.map((footer) => {
                      const meta = footer.column.columnDef.meta
                      return (
                        <TableCell
                          key={footer.id}
                          className={meta?.cellClassName}
                        >
                          {footer.isPlaceholder
                            ? null
                            : flexRender(
                                footer.column.columnDef.footer,
                                footer.getContext(),
                              )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
      {selectedField ? (
        <MarkPanel
          key={selectedField.id}
          farmId={farmId}
          field={selectedField}
          isSimulationView={isSimulationView}
          simulationId={simulationId}
          simulation={simulation}
          cropColorMap={cropColorMap}
          isLocked={isFieldLocked(selectedField)}
          isLockingInProgress={lockingFieldId === selectedField.id}
          onToggleLock={() => void toggleFieldLock(selectedField)}
          isDetaching={detachingFieldId === selectedField.id}
          onRequestDetach={() => setConfirmDetachField(selectedField)}
          onClose={() => setSelectedFieldId(null)}
          onError={onError}
        />
      ) : null}
      <Dialog
        open={confirmDetachField !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDetachField(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fjern mark?</DialogTitle>
            <DialogDescription>
              Marken {confirmDetachField?.name} fjernes fra bedriften. Det
              ændrer ikke registret.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDetachField(null)}
            >
              Annuller
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const fieldToDetach = confirmDetachField
                setConfirmDetachField(null)
                if (fieldToDetach) void detachFarmField(fieldToDetach.id)
              }}
            >
              Fjern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
