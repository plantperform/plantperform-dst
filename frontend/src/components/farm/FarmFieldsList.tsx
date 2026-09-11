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
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { mutate } from 'swr'

import { simulationFieldsKey, useFarmFields } from '@/api/hooks'
import { updateSimulationField } from '@/api/mutations'
import type { FieldRecord, Simulation } from '@/api/types'
import {
  catchmentKey,
  fieldInCatchment,
} from '@/components/farm/catchment-options'
import { CropGroupLegend } from '@/components/farm/CropGroupLegend'
import {
  DEFAULT_FIELDS_SORT,
  OPTIONAL_COLUMN_IDS,
  readStoredColumnVisibility,
  resolveEffectiveFieldsSort,
  storeColumnVisibility,
  type FieldsSortKey,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import { buildFarmFieldsColumns } from '@/components/farm/farm-fields-columns'
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
  catchmentRuns,
  changedFieldIds,
  computeFieldTotals,
  describeCatchmentsOverQuota,
  farmQuotaStatusLevel,
  formatCatchmentAmount,
  formatFieldCount,
  formatNumber,
  getFieldQuotaStatus,
  isFieldLocked,
  QUOTA_STATUS_STYLES,
  totalsQuotaStatusLevel,
  type CatchmentOverview,
  type FieldTotals,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const ROW_ACCENT_CLASS =
  'relative before:absolute before:inset-y-0 before:left-0 before:w-0.5'

type CatchmentGroupRowProps = {
  kystvandId: number | null
  label: string
  totals: FieldTotals
  colorClass: string
  colSpan: number
  selected: boolean
  isDimmed: boolean
  onToggle: (key: string, selected: boolean) => void
}

const CatchmentGroupRow = memo(
  ({
    kystvandId,
    label,
    totals,
    colorClass,
    colSpan,
    selected,
    isDimmed,
    onToggle,
  }: CatchmentGroupRowProps) => {
    const style = QUOTA_STATUS_STYLES[totalsQuotaStatusLevel(totals)]
    return (
      <TableRow aria-label={`Kystvandopland ${label}`}>
        <TableCell
          colSpan={colSpan}
          className="sticky top-(--list-header-height) z-10 bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-card))] p-0 text-xs whitespace-nowrap"
        >
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(catchmentKey(kystvandId), selected)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
              selected
                ? cn(
                    ROW_ACCENT_CLASS,
                    'bg-primary/5 text-primary before:bg-primary hover:bg-primary/10',
                  )
                : isDimmed && 'opacity-50',
            )}
          >
            <span
              aria-hidden="true"
              className={cn('size-2 shrink-0 rounded-full', colorClass)}
            />
            <span className={selected ? 'font-semibold' : 'font-medium'}>
              {label}
            </span>
            <span className="text-muted-foreground">
              {formatFieldCount(totals.fieldCount)} ·{' '}
              {formatNumber(totals.areaHa)} ha ·
            </span>
            <span className={cn('font-semibold tabular-nums', style.text)}>
              {formatCatchmentAmount(totals)}
            </span>
          </button>
        </TableCell>
      </TableRow>
    )
  },
)
CatchmentGroupRow.displayName = 'CatchmentGroupRow'

type FieldRowProps = {
  field: FieldRecord
  cells: Cell<FieldRecord, unknown>[]
  isRules: boolean
  isSelected: boolean
  isHovered: boolean
  isChanged: boolean
  isDimmed: boolean
  accentClassName?: string
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
    accentClassName,
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
          'group h-10 hover:bg-muted full:h-13',
          isRules
            ? 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset'
            : 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          isDimmed && 'opacity-50',
          isSelected
            ? 'bg-secondary hover:bg-secondary'
            : isHovered
              ? 'bg-muted'
              : isChanged
                ? 'bg-blue-50'
                : undefined,
        )}
      >
        {cells.map((cell, index) => (
          <TableCell
            key={cell.id}
            className={cn(
              cell.column.columnDef.meta?.cellClassName,
              index === 0 && accentClassName,
            )}
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
  catchmentLabel: (kystvandId: number | null) => string
  catchmentColor: (kystvandId: number | null) => string
  onHighlightedCatchmentKeyChange: (key: string | null) => void
  onZoomToField?: (fieldId: string) => void
  focusRequest?: { fieldId: string; nonce: number }
  selectedYearIndex?: number | null
  paneWidth?: number
  onRequiredWidthChange?: (width: number) => void
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
  catchmentLabel,
  catchmentColor,
  onHighlightedCatchmentKeyChange,
  onZoomToField,
  focusRequest,
  selectedYearIndex = null,
  paneWidth,
  onRequiredWidthChange,
  onError,
}: FarmFieldsListProps) => {
  const [lockingFieldId, setLockingFieldId] = useState<string | null>(null)
  const [bindFieldId, setBindFieldId] = useState<string | null>(null)
  const rowElements = useRef(new Map<string, HTMLTableRowElement>())
  const scrolledFieldId = useRef<string | null>(null)
  const focusedNonce = useRef(focusRequest?.nonce ?? null)
  const rootRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const headerRef = useRef<HTMLTableSectionElement>(null)
  const [headerHeight, setHeaderHeight] = useState(40)
  const [requiredWidth, setRequiredWidth] = useState<number | null>(null)
  const [rootWidth, setRootWidth] = useState<number | null>(null)

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

  const runStarts = useMemo(() => {
    if (isRules) return null
    return new Map(
      catchmentRuns(sortedFields, isSimulationView).map((run) => [
        run.firstFieldId,
        run,
      ]),
    )
  }, [isRules, sortedFields, isSimulationView])

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => readStoredColumnVisibility(isSimulationView),
  )
  useEffect(() => {
    const nextVisibility = readStoredColumnVisibility(isSimulationView)
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
    onHighlightedCatchmentKeyChange,
  })
  useEffect(() => {
    rowCallbacks.current = {
      onSelectedFieldChange,
      onHoveredFieldChange,
      onZoomToField,
      onHighlightedCatchmentKeyChange,
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
  const toggleCatchment = useCallback((key: string, selected: boolean) => {
    rowCallbacks.current.onHighlightedCatchmentKeyChange(selected ? null : key)
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
    if (highlightedCatchmentKey === null) return
    tableRef.current?.parentElement?.scrollTo({ top: 0 })
  }, [highlightedCatchmentKey])

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
        catchmentLabel,
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
      catchmentLabel,
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

  const handleColumnVisibilityChange: OnChangeFn<VisibilityState> = (
    updater,
  ) => {
    const next =
      typeof updater === 'function' ? updater(columnVisibility) : updater
    setColumnVisibility(next)
    storeColumnVisibility(isSimulationView, next)
  }

  const table = useReactTable({
    data: sortedFields,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const optionalColumns = table
    .getAllLeafColumns()
    .filter((column) => column.columnDef.meta?.toggleLabel !== undefined)
  const visibleOptionalCount = optionalColumns.filter((column) =>
    column.getIsVisible(),
  ).length

  const hasFields = sortedFields.length > 0

  useLayoutEffect(() => {
    const root = rootRef.current
    const table = tableRef.current
    const container = table?.parentElement
    if (!root || !table || !container) return
    let cancelled = false
    const measure = () => {
      const previousDensity = root.getAttribute('data-density')
      root.setAttribute('data-density', 'full')
      table.style.width = '0px'
      const naturalWidth = Math.ceil(table.getBoundingClientRect().width)
      table.style.width = ''
      if (previousDensity === null) root.removeAttribute('data-density')
      else root.setAttribute('data-density', previousDensity)
      const required = naturalWidth + root.offsetWidth - container.clientWidth
      setRequiredWidth(required)
      setRootWidth(root.offsetWidth)
      onRequiredWidthChange?.(required)
    }
    measure()
    void document.fonts.ready.then(() => {
      if (!cancelled) measure()
    })
    return () => {
      cancelled = true
    }
  }, [columns, columnVisibility, runStarts, onRequiredWidthChange])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => setRootWidth(root.offsetWidth))
    observer.observe(root)
    return () => observer.disconnect()
  }, [hasFields])

  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    const observer = new ResizeObserver(() =>
      setHeaderHeight(Math.round(header.getBoundingClientRect().height)),
    )
    observer.observe(header)
    return () => observer.disconnect()
  }, [hasFields])

  const availableWidth = Math.min(
    paneWidth ?? Number.POSITIVE_INFINITY,
    rootWidth ?? Number.POSITIVE_INFINITY,
  )
  const density =
    requiredWidth !== null && availableWidth >= requiredWidth
      ? 'full'
      : 'compact'

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
      <div
        ref={rootRef}
        data-density={density}
        style={{ '--list-header-height': `${headerHeight}px` } as CSSProperties}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          className={cn(
            'flex min-h-64 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-xs',
            isRules && 'border-rules/30',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2">
            {isRules ? (
              <p className="text-xs text-muted-foreground">
                Hvad optimeringen må gøre ved hver mark. Ændringer her styrer
                næste kørsel - de er ikke tal, marken har.
              </p>
            ) : (
              <>
                <CropGroupLegend fields={sortedFields} />
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
              </>
            )}
          </div>
          <Table
            ref={tableRef}
            containerClassName="min-h-0 flex-1 scroll-pt-[calc(var(--list-header-height)_+_29px)] scroll-pb-24"
            className="border-separate border-spacing-0 text-left"
          >
            <TableHeader
              ref={headerRef}
              className={cn(
                '[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:border-b',
                isRules
                  ? '[&_th]:bg-card [&_th]:bg-linear-to-b [&_th]:from-rules/10 [&_th]:to-rules/10'
                  : '[&_th]:bg-muted',
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
                const cells = row.getVisibleCells()
                const isSelected = selectedFieldId === field.id
                const isDimmed =
                  highlightedCatchmentKey !== null &&
                  !fieldInCatchment(field, highlightedCatchmentKey)
                const rowAccent = isRules
                  ? null
                  : isSelected
                    ? 'before:bg-primary'
                    : QUOTA_STATUS_STYLES[
                        getFieldQuotaStatus(field, isSimulationView).level
                      ].rowAccent
                const run = runStarts?.get(field.id)
                return (
                  <Fragment key={field.id}>
                    {run ? (
                      <CatchmentGroupRow
                        kystvandId={run.kystvandId}
                        label={catchmentLabel(run.kystvandId)}
                        totals={run.totals}
                        colorClass={catchmentColor(run.kystvandId)}
                        colSpan={cells.length}
                        selected={fieldInCatchment(run, highlightedCatchmentKey)}
                        isDimmed={isDimmed}
                        onToggle={toggleCatchment}
                      />
                    ) : null}
                    <FieldRow
                      field={field}
                      cells={cells}
                      isRules={isRules}
                      isSelected={isSelected}
                      accentClassName={
                        rowAccent ? cn(ROW_ACCENT_CLASS, rowAccent) : undefined
                      }
                      isHovered={hoveredFieldId === field.id}
                      isChanged={changedFields.has(field.id)}
                      isDimmed={isDimmed}
                      onSelect={selectRow}
                      onZoom={zoomToRow}
                      onHover={hoverRow}
                      registerRow={registerRow}
                    />
                  </Fragment>
                )
              })}
            </TableBody>
            <TableFooter className="bg-transparent font-semibold [&_td]:sticky [&_td]:bottom-0 [&_td]:z-20 [&_td]:border-t [&_td]:bg-muted [&_td]:py-2">
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
