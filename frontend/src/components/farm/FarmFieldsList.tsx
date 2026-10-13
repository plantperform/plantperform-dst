import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Cell,
  type Column,
  type OnChangeFn,
  type Row,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import { Columns3 } from 'lucide-react'
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { useFarmFields } from '@/api/hooks'
import type { FieldRecord, FieldYearValues } from '@/api/types'
import {
  catchmentKey,
  fieldInCatchment,
} from '@/components/farm/catchment-options'
import { CropGroupLegend } from '@/components/farm/CropGroupLegend'
import {
  DEFAULT_FIELDS_SORT,
  OPTIONAL_COLUMN_IDS,
  readStoredColumnVisibility,
  storeColumnVisibility,
  withoutManureColumns,
  type FieldsSortKey,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import { buildFarmFieldsColumns } from '@/components/farm/farm-fields-columns'
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
import { fertiliserByFieldId, usesManure } from '@/lib/fertiliser-overview'
import {
  catchmentRuns,
  changedFieldIds,
  fieldDisplayName,
  formatCatchmentAmount,
  formatFieldCount,
  formatNumber,
  getFieldQuotaStatus,
  QUOTA_STATUS_STYLES,
  resolveFarmQuota,
  totalsQuotaStatusLevel,
  type FieldTotals,
} from '@/lib/field-domain'
import {
  fieldListItems,
  widestItems,
  withGaps,
  withGroupRows,
} from '@/lib/field-list-rows'
import { cn } from '@/lib/utils'

type ColumnToggle = {
  id: string
  label: string
  columns: Column<FieldRecord, unknown>[]
}

const ROW_ACCENT_CLASS =
  'relative before:absolute before:inset-y-0 before:left-0 before:w-0.5'

const ROOT_FONT_SIZE = parseFloat(
  getComputedStyle(document.documentElement).fontSize,
)
const remToPx = (rem: number) => Math.ceil(rem * ROOT_FONT_SIZE)

const GROUP_ROW_HEIGHT = remToPx(1.75) + 1
const FIELD_ROW_HEIGHT = { compact: remToPx(2.5), full: remToPx(3.25) }
const ROW_OVERSCAN = 8
const FOOTER_SCROLL_PADDING = remToPx(6)

type CatchmentGroupRowProps = {
  catchmentId: number | null
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
    catchmentId,
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
      <TableRow
        aria-label={`Kystvandopland ${label}`}
        style={{ height: GROUP_ROW_HEIGHT }}
      >
        <TableCell
          colSpan={colSpan}
          className="sticky top-(--list-header-height) z-10 bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-card))] p-0 text-xs whitespace-nowrap"
        >
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(catchmentKey(catchmentId), selected)}
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
  isSelected: boolean
  isHovered: boolean
  isChanged: boolean
  isDimmed: boolean
  accentClassName?: string
  height: number
  onSelect: (fieldId: string, isSelected: boolean) => void
  onZoom: (fieldId: string) => void
  onHover: (fieldId: string | null) => void
}

const FieldRow = memo(
  ({
    field,
    cells,
    isSelected,
    isHovered,
    isChanged,
    isDimmed,
    accentClassName,
    height,
    onSelect,
    onZoom,
    onHover,
  }: FieldRowProps) => {
    const openPanel = () => onSelect(field.id, isSelected)

    return (
      <TableRow
        onClick={openPanel}
        onDoubleClick={() => onZoom(field.id)}
        onMouseEnter={() => onHover(field.id)}
        onMouseLeave={() => onHover(null)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          openPanel()
        }}
        tabIndex={0}
        aria-label={`Vis detaljer for mark ${fieldDisplayName(field)}`}
        data-selected={isSelected}
        style={{ height }}
        className={cn(
          'group cursor-pointer hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
          isDimmed && 'opacity-50',
          isSelected
            ? 'bg-secondary hover:bg-secondary'
            : isHovered
              ? 'bg-muted'
              : isChanged
                ? 'bg-changed/30'
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

const SizerRow = memo(({ cells }: { cells: Cell<FieldRecord, unknown>[] }) => (
  <tr>
    {cells.map((cell) => (
      <TableCell
        key={cell.id}
        className={cn(
          cell.column.columnDef.meta?.cellClassName,
          'py-0 full:py-0',
        )}
      >
        <div className="h-0 overflow-hidden">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </div>
      </TableCell>
    ))}
  </tr>
))
SizerRow.displayName = 'SizerRow'

type FarmFieldsListProps = {
  farmId: string
  sortedFields: FieldRecord[]
  isSimulationView?: boolean
  sort: FieldsSortState
  onSortChange: (sort: FieldsSortState) => void
  selectedFieldId: string | null
  onSelectedFieldChange: (fieldId: string | null) => void
  hoveredFieldId: string | null
  onHoveredFieldChange: (fieldId: string | null) => void
  highlightedCatchmentKey?: string | null
  catchmentLabel: (catchmentId: number | null) => string
  catchmentColor: (catchmentId: number | null) => string
  onHighlightedCatchmentKeyChange: (key: string | null) => void
  onZoomToField?: (fieldId: string) => void
  selectedYearIndex?: number | null
  yearValues?: FieldYearValues
  yearValuesLoading?: boolean
  paneWidth?: number
  onRequiredWidthChange?: (width: number) => void
  detachingFieldIds: string[]
  onRequestDetach?: (field: FieldRecord) => void
  search?: ReactNode
}

export const FarmFieldsList = ({
  farmId,
  sortedFields,
  isSimulationView = false,
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
  selectedYearIndex = null,
  yearValues,
  yearValuesLoading = false,
  paneWidth,
  onRequiredWidthChange,
  detachingFieldIds,
  onRequestDetach,
  search,
}: FarmFieldsListProps) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const headerRef = useRef<HTMLTableSectionElement>(null)
  const [headerHeight, setHeaderHeight] = useState(40)
  const [requiredWidth, setRequiredWidth] = useState<number | null>(null)
  const [rootWidth, setRootWidth] = useState<number | null>(null)

  const maxYears = Math.max(
    0,
    ...sortedFields.map((field) => field.cropRotation.length),
  )

  const { data: liveFields = [] } = useFarmFields(farmId)
  const changedFields = useMemo(
    () => changedFieldIds(sortedFields, liveFields),
    [sortedFields, liveFields],
  )

  const quota = useMemo(
    () => resolveFarmQuota(sortedFields, isSimulationView),
    [sortedFields, isSimulationView],
  )

  const fertiliser = useMemo(
    () =>
      isSimulationView
        ? fertiliserByFieldId(sortedFields, yearValues, selectedYearIndex)
        : new Map(),
    [isSimulationView, sortedFields, yearValues, selectedYearIndex],
  )

  const runStarts = useMemo(
    () =>
      new Map(
        catchmentRuns(sortedFields, isSimulationView).map((run) => [
          run.firstFieldId,
          run,
        ]),
      ),
    [sortedFields, isSimulationView],
  )

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

  const shownColumnVisibility = useMemo(
    () =>
      usesManure(yearValues)
        ? columnVisibility
        : withoutManureColumns(columnVisibility),
    [columnVisibility, yearValues],
  )

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

  const selectRow = useCallback((fieldId: string, isSelected: boolean) => {
    rowCallbacks.current.onSelectedFieldChange(isSelected ? null : fieldId)
  }, [])
  const zoomToRow = useCallback((fieldId: string) => {
    rowCallbacks.current.onSelectedFieldChange(fieldId)
    rowCallbacks.current.onZoomToField?.(fieldId)
  }, [])
  const toggleCatchment = useCallback((key: string, selected: boolean) => {
    startTransition(() =>
      rowCallbacks.current.onHighlightedCatchmentKeyChange(
        selected ? null : key,
      ),
    )
  }, [])
  const hoverRow = useCallback((fieldId: string | null) => {
    rowCallbacks.current.onHoveredFieldChange(fieldId)
  }, [])

  useEffect(() => {
    if (highlightedCatchmentKey === null) return
    tableRef.current?.parentElement?.scrollTo({ top: 0 })
  }, [highlightedCatchmentKey])

  const columns = useMemo(
    () =>
      buildFarmFieldsColumns({
        isSimulationView,
        maxYears,
        selectedYearIndex,
        fields: sortedFields,
        fertiliser,
        fertiliserLoading: yearValuesLoading,
        quota,
        catchmentLabel,
        detachingFieldIds,
        onRequestDetach,
      }),
    [
      isSimulationView,
      maxYears,
      selectedYearIndex,
      sortedFields,
      fertiliser,
      yearValuesLoading,
      quota,
      catchmentLabel,
      detachingFieldIds,
      onRequestDetach,
    ],
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
    state: { sorting, columnVisibility: shownColumnVisibility },
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  // Columns sharing a toggle group are one entry in the menu.
  const columnToggles: ColumnToggle[] = []
  for (const column of table.getAllLeafColumns()) {
    const meta = column.columnDef.meta
    if (meta?.toggleLabel === undefined) continue
    const id = meta.toggleGroup ?? column.id
    const toggle = columnToggles.find((candidate) => candidate.id === id)
    if (toggle) toggle.columns.push(column)
    else columnToggles.push({ id, label: meta.toggleLabel, columns: [column] })
  }
  const isToggleVisible = (toggle: ColumnToggle) =>
    toggle.columns.some((column) => column.getIsVisible())
  const visibleOptionalCount = columnToggles.filter(isToggleVisible).length

  const availableWidth = Math.min(
    paneWidth ?? Number.POSITIVE_INFINITY,
    rootWidth ?? Number.POSITIVE_INFINITY,
  )
  const density =
    requiredWidth !== null && availableWidth >= requiredWidth
      ? 'full'
      : 'compact'

  const stickyHeight = headerHeight + GROUP_ROW_HEIGHT
  const rows = table.getRowModel().rows
  const visibleColumns = table.getVisibleLeafColumns()
  const items = useMemo(
    () => fieldListItems(sortedFields, runStarts),
    [sortedFields, runStarts],
  )
  const groupIndexes = useMemo(
    () =>
      items.flatMap((item, index) => (item.kind === 'group' ? [index] : [])),
    [items],
  )
  const getItemKey = useCallback((index: number) => items[index].key, [items])
  const extractRange = useCallback(
    (range: Range) => withGroupRows(defaultRangeExtractor(range), groupIndexes),
    [groupIndexes],
  )
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => tableRef.current?.parentElement ?? null,
    estimateSize: (index) =>
      items[index].kind === 'group'
        ? GROUP_ROW_HEIGHT
        : FIELD_ROW_HEIGHT[density],
    getItemKey,
    rangeExtractor: extractRange,
    overscan: ROW_OVERSCAN,
    scrollMargin: headerHeight,
    scrollPaddingStart: stickyHeight,
    scrollPaddingEnd: FOOTER_SCROLL_PADDING,
    initialRect: { width: 0, height: window.innerHeight },
  })
  const virtualRows = virtualizer.getVirtualItems()
  const isWindowed = virtualRows.length < items.length
  const sizerRows = useMemo(() => {
    if (!isWindowed) return []
    const hints = visibleColumns.flatMap(
      (column) => column.columnDef.meta?.widthHints ?? [],
    )
    return widestItems(
      rows,
      hints.map((hint) => (row: Row<FieldRecord>) => hint(row.original)),
    )
  }, [isWindowed, visibleColumns, rows])

  useLayoutEffect(() => {
    virtualizer.measure()
  }, [virtualizer, density])

  const scrollToField = useEffectEvent((fieldId: string | null) => {
    const index = items.findIndex((item) => item.key === fieldId)
    if (index !== -1) virtualizer.scrollToIndex(index)
  })
  useEffect(() => {
    scrollToField(selectedFieldId)
  }, [selectedFieldId])

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
  }, [columns, shownColumnVisibility, runStarts, onRequiredWidthChange])

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

  if (sortedFields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isSimulationView ? 'Optimeringen er ikke kørt endnu' : 'Ingen marker endnu'}
          </CardTitle>
          <CardDescription>
            {isSimulationView
              ? 'Kør en optimering for at beregne simuleringens værdier.'
              : 'Slå Rediger marker til på kortet for at gennemgå registermarker, før du tilføjer dem.'}
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
        style={
          {
            '--list-header-height': `${headerHeight}px`,
            '--list-scroll-top': `${stickyHeight}px`,
            '--list-scroll-bottom': `${FOOTER_SCROLL_PADDING}px`,
          } as CSSProperties
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex min-h-64 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
            {search}
            <CropGroupLegend fields={sortedFields} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="xs"
                      className="ml-auto gap-1.5"
                    >
                      <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Kolonner
                      <span className="text-muted-foreground">
                        {visibleOptionalCount} af {columnToggles.length}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {columnToggles.map((toggle) => (
                      <DropdownMenuCheckboxItem
                        key={toggle.id}
                        checked={isToggleVisible(toggle)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) => {
                          // One update, since each toggleVisibility call
                          // would start from the same stale visibility.
                          table.setColumnVisibility((current) => ({
                            ...current,
                            ...Object.fromEntries(
                              toggle.columns.map((column) => [
                                column.id,
                                Boolean(checked),
                              ]),
                            ),
                          }))
                          if (
                            !checked &&
                            toggle.columns.some(
                              (column) => column.id === sort.key,
                            )
                          ) {
                            onSortChange(DEFAULT_FIELDS_SORT)
                          }
                        }}
                      >
                        {toggle.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
          </div>
          <Table
            ref={tableRef}
            containerClassName="min-h-0 flex-1 scroll-pt-(--list-scroll-top) scroll-pb-(--list-scroll-bottom) [overflow-anchor:none]"
            className="h-full border-separate border-spacing-0 text-left"
          >
            <TableHeader
              ref={headerRef}
              className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:border-b [&_th]:bg-muted"
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
            {sizerRows.length > 0 ? (
              <tbody className="invisible">
                {sizerRows.map((row) => (
                  <SizerRow key={row.id} cells={row.getVisibleCells()} />
                ))}
              </tbody>
            ) : null}
            <TableBody className="[&_td]:border-b [&_tr:nth-last-child(-n+2)_td]:border-b-0 [&_tr[aria-hidden]_td]:border-b-0">
              {withGaps(
                virtualRows,
                headerHeight,
                headerHeight + virtualizer.getTotalSize(),
              ).map((slot) => {
                if (slot.kind === 'gap') {
                  return (
                    <tr
                      key={slot.key}
                      aria-hidden="true"
                      style={{ height: slot.height }}
                    >
                      <td colSpan={visibleColumns.length} className="p-0" />
                    </tr>
                  )
                }
                const item = items[slot.index]
                if (item.kind === 'group') {
                  const selected = fieldInCatchment(
                    item.run,
                    highlightedCatchmentKey,
                  )
                  return (
                    <CatchmentGroupRow
                      key={item.key}
                      catchmentId={item.run.catchmentId}
                      label={catchmentLabel(item.run.catchmentId)}
                      totals={item.run.totals}
                      colorClass={catchmentColor(item.run.catchmentId)}
                      colSpan={visibleColumns.length}
                      selected={selected}
                      isDimmed={highlightedCatchmentKey !== null && !selected}
                      onToggle={toggleCatchment}
                    />
                  )
                }
                const row = rows[item.rowIndex]
                const field = row.original
                const isSelected = selectedFieldId === field.id
                const isDimmed =
                  highlightedCatchmentKey !== null &&
                  !fieldInCatchment(field, highlightedCatchmentKey)
                const rowAccent = isSelected
                  ? 'before:bg-primary'
                  : QUOTA_STATUS_STYLES[
                      getFieldQuotaStatus(field, isSimulationView).level
                    ].rowAccent
                return (
                  <FieldRow
                    key={item.key}
                    field={field}
                    cells={row.getVisibleCells()}
                    isSelected={isSelected}
                    accentClassName={
                      rowAccent ? cn(ROW_ACCENT_CLASS, rowAccent) : undefined
                    }
                    isHovered={hoveredFieldId === field.id}
                    isChanged={changedFields.has(field.id)}
                    isDimmed={isDimmed}
                    height={FIELD_ROW_HEIGHT[density]}
                    onSelect={selectRow}
                    onZoom={zoomToRow}
                    onHover={hoverRow}
                  />
                )
              })}
              <tr aria-hidden="true" className="h-full">
                <td colSpan={visibleColumns.length} className="p-0" />
              </tr>
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
    </>
  )
}
