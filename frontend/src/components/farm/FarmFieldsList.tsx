import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Cell,
  type OnChangeFn,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { Columns3 } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mutate } from 'swr'

import { simulationFieldsKey, useFarmFields } from '@/api/hooks'
import { updateSimulationField } from '@/api/mutations'
import type { FieldRecord, Simulation } from '@/api/types'
import { catchmentKey } from '@/components/farm/catchment-options'
import { CropGroupLegend } from '@/components/farm/CropGroupLegend'
import {
  DEFAULT_FIELDS_SORT,
  resolveEffectiveFieldsSort,
  type FieldsSortKey,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import {
  buildFarmFieldsColumns,
  OPTIONAL_COLUMN_IDS,
} from '@/components/farm/farm-fields-columns'
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import type { FarmInspectorMode } from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  changedFieldIds,
  computeFieldTotals,
  describeCatchmentsOverQuota,
  farmQuotaStatusLevel,
  isFieldLocked,
  type CatchmentOverview,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const SIMULATION_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'db2',
  'quotaStatus',
])
const CURRENT_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'quotaStatus',
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

type FieldRowProps = {
  field: FieldRecord
  cells: Cell<FieldRecord, unknown>[]
  isRules: boolean
  isSelected: boolean
  isHovered: boolean
  isChanged: boolean
  isDimmed: boolean
  onSelect: (fieldId: string, isSelected: boolean) => void
  onZoom: (fieldId: string) => void
  onHover: (fieldId: string | null) => void
  registerRow: (fieldId: string, element: HTMLTableRowElement | null) => void
}

const FieldRow = memo(
  ({
    field,
    cells,
    isRules,
    isSelected,
    isHovered,
    isChanged,
    isDimmed,
    onSelect,
    onZoom,
    onHover,
    registerRow,
  }: FieldRowProps) => {
    const setRowElement = useCallback(
      (element: HTMLTableRowElement | null) => {
        registerRow(field.id, element)
      },
      [registerRow, field.id],
    )
    const openPanel = () => onSelect(field.id, isSelected)

    return (
      <TableRow
        ref={setRowElement}
        onClick={isRules ? undefined : openPanel}
        onDoubleClick={isRules ? undefined : () => onZoom(field.id)}
        onMouseEnter={() => onHover(field.id)}
        onMouseLeave={() => onHover(null)}
        onKeyDown={
          isRules
            ? undefined
            : (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                openPanel()
              }
        }
        tabIndex={isRules ? -1 : 0}
        aria-label={isRules ? undefined : `Vis detaljer for mark ${field.name}`}
        data-selected={isSelected}
        className={cn(
          isRules
            ? 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset'
            : 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          isDimmed && 'opacity-50',
          isSelected
            ? 'bg-secondary/50'
            : isHovered
              ? 'bg-muted/60'
              : isChanged
                ? 'bg-blue-50'
                : undefined,
        )}
      >
        {cells.map((cell) => (
          <TableCell
            key={cell.id}
            className={cell.column.columnDef.meta?.cellClassName}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
    )
  },
)
FieldRow.displayName = 'FieldRow'

type FarmFieldsListProps = {
  farmId: string
  sortedFields: FieldRecord[]
  isSimulationView?: boolean
  catchmentOverview: CatchmentOverview
  simulationId?: string
  simulation?: Simulation
  mode?: FarmInspectorMode
  sort: FieldsSortState
  onSortChange: (sort: FieldsSortState) => void
  selectedFieldId: string | null
  onSelectedFieldChange: (fieldId: string | null) => void
  hoveredFieldId: string | null
  onHoveredFieldChange: (fieldId: string | null) => void
  highlightedCatchmentKey?: string | null
  onZoomToField?: (fieldId: string) => void
  focusRequest?: { fieldId: string; nonce: number }
  selectedYearIndex?: number | null
  onError: (message: string | null) => void
}

export const FarmFieldsList = ({
  farmId,
  sortedFields,
  isSimulationView = false,
  catchmentOverview,
  simulationId,
  simulation,
  mode = 'values',
  sort,
  onSortChange,
  selectedFieldId,
  onSelectedFieldChange,
  hoveredFieldId,
  onHoveredFieldChange,
  highlightedCatchmentKey = null,
  onZoomToField,
  focusRequest,
  selectedYearIndex = null,
  onError,
}: FarmFieldsListProps) => {
  const [lockingFieldId, setLockingFieldId] = useState<string | null>(null)
  const [bindFieldId, setBindFieldId] = useState<string | null>(null)
  const rowElements = useRef(new Map<string, HTMLTableRowElement>())
  const scrolledFieldId = useRef<string | null>(null)
  const focusedNonce = useRef(focusRequest?.nonce ?? null)

  const isRules = mode === 'rules'
  const canEditRules = isRules && isSimulationView && Boolean(simulationId)
  const effectiveSort = resolveEffectiveFieldsSort(sort, isRules)

  const bindField =
    sortedFields.find((field) => field.id === bindFieldId) ?? null

  const maxYears = Math.max(
    0,
    ...sortedFields.map((field) => field.cropRotation.length),
  )

  const { data: liveFields = [] } = useFarmFields(farmId)
  const changedFields = useMemo(
    () =>
      isRules ? new Set<string>() : changedFieldIds(sortedFields, liveFields),
    [isRules, sortedFields, liveFields],
  )

  const totals = useMemo(
    () => computeFieldTotals(sortedFields, isSimulationView),
    [sortedFields, isSimulationView],
  )

  const quotaFooterLevel = farmQuotaStatusLevel(totals, catchmentOverview)
  const quotaFooterNote = describeCatchmentsOverQuota(catchmentOverview)

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

  const rowCallbacks = useRef({
    onSelectedFieldChange,
    onHoveredFieldChange,
    onZoomToField,
  })
  useEffect(() => {
    rowCallbacks.current = {
      onSelectedFieldChange,
      onHoveredFieldChange,
      onZoomToField,
    }
  })

  const registerRow = useCallback(
    (fieldId: string, element: HTMLTableRowElement | null) => {
      if (element) rowElements.current.set(fieldId, element)
      else rowElements.current.delete(fieldId)
    },
    [],
  )
  const selectRow = useCallback((fieldId: string, isSelected: boolean) => {
    rowCallbacks.current.onSelectedFieldChange(isSelected ? null : fieldId)
  }, [])
  const zoomToRow = useCallback((fieldId: string) => {
    rowCallbacks.current.onSelectedFieldChange(fieldId)
    rowCallbacks.current.onZoomToField?.(fieldId)
  }, [])
  const hoverRow = useCallback((fieldId: string | null) => {
    rowCallbacks.current.onHoveredFieldChange(fieldId)
  }, [])

  useEffect(() => {
    if (scrolledFieldId.current === selectedFieldId) return
    scrolledFieldId.current = selectedFieldId
    if (selectedFieldId === null) return
    rowElements.current.get(selectedFieldId)?.scrollIntoView({
      block: 'nearest',
    })
  }, [selectedFieldId])

  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === focusedNonce.current) return
    focusedNonce.current = focusRequest.nonce
    const row = rowElements.current.get(focusRequest.fieldId)
    if (!row) return
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest' })
  }, [focusRequest])

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
    [farmId, simulationId, onError],
  )

  const onToggleLock = useCallback(
    (field: FieldRecord) => void toggleFieldLock(field),
    [toggleFieldLock],
  )
  const onBindRotation = useCallback(
    (field: FieldRecord) => setBindFieldId(field.id),
    [],
  )

  const columns = useMemo(
    () =>
      buildFarmFieldsColumns({
        isSimulationView,
        mode,
        maxYears,
        selectedYearIndex,
        fields: sortedFields,
        totals,
        quotaFooterLevel,
        quotaFooterNote,
        canEditRules,
        lockingFieldId,
        onToggleLock,
        onBindRotation,
      }),
    [
      isSimulationView,
      mode,
      maxYears,
      selectedYearIndex,
      sortedFields,
      totals,
      quotaFooterLevel,
      quotaFooterNote,
      canEditRules,
      lockingFieldId,
      onToggleLock,
      onBindRotation,
    ],
  )

  const sorting: SortingState = useMemo(
    () => [
      { id: effectiveSort.key, desc: effectiveSort.direction === 'desc' },
    ],
    [effectiveSort],
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

  if (sortedFields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tilføj marker fra kortet</CardTitle>
          <CardDescription>
            {isSimulationView
              ? 'Denne simulering blev oprettet, før der var tilknyttet aktuelle marker.'
              : 'Slå Tilføj marker til på kortet for at gennemgå registermarker, før du tilføjer dem.'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {isRules ? (
          <p className="text-xs text-muted-foreground">
            Hvad optimeringen må gøre ved hver mark. Ændringer her styrer næste
            kørsel - de er ikke tal, marken har.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="xs" className="ml-auto gap-1.5">
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
          </div>
        )}
        {isRules ? null : <CropGroupLegend fields={sortedFields} />}
        <div
          className={cn(
            'flex min-h-64 flex-1 flex-col overflow-hidden rounded-lg border bg-card',
            isRules && 'border-rules/30',
          )}
        >
          <Table
            containerClassName="min-h-0 flex-1 scroll-pt-10 scroll-pb-24"
            className="border-separate border-spacing-0 text-left"
          >
            <TableHeader
              className={cn(
                '[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:border-b [&_th]:bg-card [&_th]:bg-linear-to-b',
                isRules
                  ? '[&_th]:from-rules/10 [&_th]:to-rules/10'
                  : '[&_th]:from-muted/60 [&_th]:to-muted/60',
              )}
            >
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
            <TableBody className="[&_td]:border-b [&_tr:last-child_td]:border-b-0">
              {table.getRowModel().rows.map((row) => {
                const field = row.original
                return (
                  <FieldRow
                    key={field.id}
                    field={field}
                    cells={row.getVisibleCells()}
                    isRules={isRules}
                    isSelected={selectedFieldId === field.id}
                    isHovered={hoveredFieldId === field.id}
                    isChanged={changedFields.has(field.id)}
                    isDimmed={
                      highlightedCatchmentKey !== null &&
                      catchmentKey(field.kystvandId) !== highlightedCatchmentKey
                    }
                    onSelect={selectRow}
                    onZoom={zoomToRow}
                    onHover={hoverRow}
                    registerRow={registerRow}
                  />
                )
              })}
            </TableBody>
            <TableFooter className="bg-transparent [&_td]:sticky [&_td]:bottom-0 [&_td]:z-20 [&_td]:border-t [&_td]:bg-card [&_td]:bg-linear-to-b [&_td]:from-muted/50 [&_td]:to-muted/50">
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
      </div>
      {bindField && simulationId && simulation ? (
        <ManualRotationEditor
          key={bindField.id}
          farmId={farmId}
          simulationId={simulationId}
          simulation={simulation}
          field={bindField}
          intent="lock"
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setBindFieldId(null)
          }}
          onError={onError}
        />
      ) : null}
    </>
  )
}
