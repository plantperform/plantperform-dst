import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import type {
  FieldRecord,
  OptimizeSimulationResponse,
  YearlySummaryEntry,
} from '@/api/types'
import { QuotaStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import { Button } from '@/components/ui/button'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import {
  computeFieldTotals,
  describeCatchmentsOverQuota,
  type CatchmentOverview,
  farmQuotaStatusLevel,
  formatCompactKr,
  formatQuotaAmount,
  formatWholeNumber,
  QUOTA_STATUS_STYLES,
  quotaStatusLevel,
  REAL_HISTORY_START_CALENDAR_YEAR,
  resolveFarmQuota,
  ROTATION_CALENDAR_YEARS,
  ROTATION_START_CALENDAR_YEAR,
  totalsQuotaStatusLevel,
  type FieldTotals,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import { useViewportShorterThan } from '@/hooks/use-viewport-height'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

const PLACEHOLDER_BAR_HEIGHTS = [34, 46, 28, 52, 38, 48, 32, 44]

type YearGroup = 'bars' | 'chips'

const COMPACT_VIEWPORT_HEIGHT = 960
const COLLAPSED_VIEWPORT_HEIGHT = 800

const RUN_STATUS_LABELS: Record<OptimizeSimulationResponse['status'], string> =
  {
    OPTIMAL: 'optimal løsning',
    FEASIBLE: 'brugbar løsning, tidsgrænsen blev nået',
  }

const describeQuotaDiff = (nLoadKg: number, quotaKgn: number): string => {
  const diff = Math.abs(Math.round(nLoadKg) - Math.round(quotaKgn))
  return `${formatWholeNumber(diff)} ${nLoadKg > quotaKgn ? 'over' : 'under'} grænsen`
}

const buildHeadline = (
  totals: FieldTotals,
  level: QuotaStatusLevel,
  overCatchmentNote: string | null,
): string => {
  if (level === 'noData') {
    return 'Kan ikke opgøres endnu - ingen udledningsgrænse på markerne'
  }
  if (level === 'uncalculated') {
    return 'Kan ikke opgøres endnu - kør Optimér for at beregne markerne'
  }
  const quotaKgn = totals.udledningskvoteMarkKgn
  const headline =
    formatQuotaAmount(totals.nLoad, quotaKgn, formatWholeNumber) +
    ` - ${describeQuotaDiff(totals.nLoad, quotaKgn)}`
  return overCatchmentNote && totals.nLoad <= quotaKgn
    ? `${headline} samlet, men ${overCatchmentNote}`
    : headline
}

type YearColumn = {
  index: number
  calendarYear: number
  entry: YearlySummaryEntry | null
}

type QuotaRelation = {
  level: QuotaStatusLevel
  text: string
}

const describeQuotaRelation = (
  nLoadKg: number,
  quotaKgn: number,
): QuotaRelation => {
  const level = quotaStatusLevel(nLoadKg, quotaKgn, true)
  if (level === 'noData') return { level, text: 'ingen grænse' }
  return { level, text: describeQuotaDiff(nLoadKg, quotaKgn) }
}

const formatNLoadAmount = (nLoadKg: number, quotaKgn: number): string =>
  `Udledning ${formatQuotaAmount(nLoadKg, quotaKgn, formatWholeNumber)}`

const QUOTA_LINE_POSITION = 0.6

const barHeightPct = (value: number, scale: number): number =>
  Math.min(100, (value / scale) * 100)

const columnTitle = (
  column: YearColumn,
  relation: QuotaRelation | null,
  loading: boolean,
  history: boolean,
): string => {
  if (loading) return `${column.calendarYear}: indlæser årstal`
  if (!column.entry) {
    return history
      ? `${column.calendarYear}: ingen historik`
      : `${column.calendarYear}: ingen årstal endnu`
  }
  return `${column.calendarYear}: DB2 ${formatCompactKr(column.entry.totalDb2)}, udledning ${formatWholeNumber(column.entry.totalNLoadKg)} kg N (${relation?.text})`
}

const buildColumns = (
  entries: YearlySummaryEntry[] | undefined,
  history: boolean,
): YearColumn[] => {
  const startCalendarYear = history
    ? REAL_HISTORY_START_CALENDAR_YEAR
    : ROTATION_START_CALENDAR_YEAR
  const yearCount = ROTATION_CALENDAR_YEARS.length
  const entriesByIndex = new Map<number, YearlySummaryEntry>()
  for (const entry of entries ?? []) {
    const index = history ? entry.year - startCalendarYear : entry.year - 1
    if (index >= 0 && index < yearCount) entriesByIndex.set(index, entry)
  }
  if (!history && entriesByIndex.size > 0) {
    return [...entriesByIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, entry]) => ({
        index,
        calendarYear: startCalendarYear + index,
        entry,
      }))
  }
  return Array.from({ length: yearCount }, (_, index) => ({
    index,
    calendarYear: startCalendarYear + index,
    entry: entriesByIndex.get(index) ?? null,
  }))
}

type YearSummaryBoxProps = {
  loading: boolean
  column: YearColumn | null
  quotaKgn: number
  fieldCount: number
  totals: FieldTotals
  catchmentOverview: CatchmentOverview
  lastRun: OptimizeSimulationResponse | null
  overYears: number[]
  yearCount: number
  history: boolean
  unavailableMessage: string | null
}

const SummaryValue = ({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) => (
  <div>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-sm font-medium tabular-nums">{children}</div>
  </div>
)

const renderYearSummary = ({
  loading,
  column,
  quotaKgn,
  fieldCount,
  totals,
  catchmentOverview,
  lastRun,
  overYears,
  yearCount,
  history,
  unavailableMessage,
}: YearSummaryBoxProps): ReactNode => {
  if (loading) {
    return (
      <>
        <div className="font-display text-2xl leading-none">
          {column ? column.calendarYear : 'Alle år'}
        </div>
        <span className="sr-only">Indlæser årstal</span>
        <div className="space-y-2 pt-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-36" />
        </div>
      </>
    )
  }

  if (column === null) {
    const calculated = totals.calculatedCount > 0
    const overLevel = overYears.length > 0 ? 'over' : 'ok'
    const totalsLevel = totalsQuotaStatusLevel(totals)
    const averageLevel = farmQuotaStatusLevel(totals, catchmentOverview)
    return (
      <>
        <div className="font-display text-2xl leading-none">Alle år</div>
        <SummaryValue label="Udledning, gennemsnit pr. år">
          <QuotaStatusIndicator
            level={averageLevel}
            badge
            className={cn(
              'items-baseline',
              QUOTA_STATUS_STYLES[averageLevel].text,
            )}
          >
            {buildHeadline(
              totals,
              totalsLevel,
              describeCatchmentsOverQuota(catchmentOverview),
            )}
          </QuotaStatusIndicator>
        </SummaryValue>
        {calculated && yearCount > 0 ? (
          <SummaryValue label="År over grænsen">
            {quotaKgn > 0 ? (
              <QuotaStatusIndicator
                level={overLevel}
                className={cn(
                  'flex-nowrap items-baseline',
                  QUOTA_STATUS_STYLES[overLevel].text,
                )}
              >
                {overYears.length > 0
                  ? `${overYears.length} af ${yearCount} år: ${overYears.join(', ')}`
                  : `Ingen af ${yearCount} år`}
              </QuotaStatusIndicator>
            ) : (
              'Ingen grænse'
            )}
          </SummaryValue>
        ) : null}
        {lastRun ? (
          <p className="text-xs text-muted-foreground">
            Sidste kørsel: {RUN_STATUS_LABELS[lastRun.status]} - DB2{' '}
            {formatCompactKr(lastRun.objectiveDb2)}, udledning{' '}
            {formatWholeNumber(lastRun.totalNLoadKg)} kg N, udvaskning{' '}
            {formatWholeNumber(lastRun.totalLeachingKg)} kg N,{' '}
            {formatWholeNumber(lastRun.totalFen)} FE
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {unavailableMessage ??
            (history
              ? 'Klik et år for at se markernes afgrøder det år.'
              : 'Klik et år for at følge planen år for år.')}
        </p>
      </>
    )
  }

  if (column.entry === null) {
    return (
      <>
        <div className="font-display text-2xl leading-none">
          {column.calendarYear}
        </div>
        <p className="text-xs text-muted-foreground">
          {unavailableMessage ??
            (history
              ? `Ingen historik for ${column.calendarYear}.`
              : `Ingen årstal for ${column.calendarYear} endnu - kør Optimér for at beregne markerne.`)}
        </p>
      </>
    )
  }

  const relation = describeQuotaRelation(column.entry.totalNLoadKg, quotaKgn)
  return (
    <>
      <div className="font-display text-2xl leading-none">
        {column.calendarYear}
      </div>
      <SummaryValue label="DB2">
        {formatCompactKr(column.entry.totalDb2)}
      </SummaryValue>
      <SummaryValue label="Udledning">
        <QuotaStatusIndicator
          level={relation.level}
          className={cn(
            'flex-nowrap items-baseline',
            QUOTA_STATUS_STYLES[relation.level].text,
          )}
        >
          {formatNLoadAmount(column.entry.totalNLoadKg, quotaKgn)} -{' '}
          {relation.text}
        </QuotaStatusIndicator>
      </SummaryValue>
      <div className="text-xs text-muted-foreground">
        {column.entry.fieldCount} af {fieldCount} marker har data for året
      </div>
    </>
  )
}

const YearSummaryBox = (props: YearSummaryBoxProps) => (
  <div
    role="status"
    aria-live="polite"
    className="basis-full @3xl:basis-64 @3xl:grow-0 @3xl:shrink-0 @3xl:border-l @3xl:pl-5"
  >
    <div
      key={props.loading ? 'loading' : (props.column?.index ?? 'all')}
      className="space-y-2 motion-safe:animate-rise-in"
    >
      {renderYearSummary(props)}
    </div>
  </div>
)

type YearWalkthroughProps = {
  entries: YearlySummaryEntry[] | undefined
  loading: boolean
  fields: FieldRecord[]
  selectedYearIndex: number | null
  onSelectedYearIndexChange: (index: number | null) => void
  catchmentOverview: CatchmentOverview
  lastRun: OptimizeSimulationResponse | null
  collapsible?: boolean
  openOverride?: boolean | null
  onOpenOverrideChange?: (open: boolean) => void
  history?: boolean
  unavailableMessage?: string | null
}

export const YearWalkthrough = ({
  entries,
  loading,
  fields,
  selectedYearIndex,
  onSelectedYearIndexChange,
  catchmentOverview,
  lastRun,
  collapsible = false,
  openOverride = null,
  onOpenOverrideChange,
  history = false,
  unavailableMessage = null,
}: YearWalkthroughProps) => {
  const compact = useViewportShorterThan(COMPACT_VIEWPORT_HEIGHT)
  const shortViewport = useViewportShorterThan(COLLAPSED_VIEWPORT_HEIGHT)
  const open = openOverride ?? !shortViewport
  const bodyId = useId()
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([])
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [lastSelectedPosition, setLastSelectedPosition] = useState(0)

  const columns = useMemo(
    () => buildColumns(loading ? undefined : entries, history),
    [entries, loading, history],
  )
  const totals = useMemo(
    () => computeFieldTotals(fields, !history),
    [fields, history],
  )
  const quotaKgn = resolveFarmQuota(totals.udledningskvoteMarkKgn).quotaKgn

  const selectedPosition = columns.findIndex(
    (column) => column.index === selectedYearIndex,
  )
  const lastPosition = columns.length - 1
  if (selectedPosition >= 0 && selectedPosition !== lastSelectedPosition) {
    setLastSelectedPosition(selectedPosition)
  }

  const selectYear = (index: number | null) => {
    onSelectedYearIndexChange(index)
  }

  const moveTo = (position: number, group: YearGroup) => {
    const clamped = Math.max(0, Math.min(lastPosition, position))
    selectYear(columns[clamped].index)
    const refs = group === 'chips' ? chipRefs : cellRefs
    refs.current[clamped]?.focus()
  }

  const handleYearKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    group: YearGroup,
  ) => {
    if (columns.length === 0) return
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveTo(selectedPosition < 0 ? 0 : selectedPosition + 1, group)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveTo(
          selectedPosition < 0 ? lastPosition : selectedPosition - 1,
          group,
        )
        break
      case 'Home':
        event.preventDefault()
        moveTo(0, group)
        break
      case 'End':
        event.preventDefault()
        moveTo(lastPosition, group)
        break
      case 'Escape':
        event.preventDefault()
        selectYear(null)
        break
      default:
        break
    }
  }

  const entryValues = columns.flatMap((column) =>
    column.entry ? [column.entry] : [],
  )
  const overYears = columns.flatMap((column) =>
    column.entry !== null &&
    quotaStatusLevel(column.entry.totalNLoadKg, quotaKgn, true) === 'over'
      ? [column.calendarYear]
      : [],
  )
  const maxNLoad = Math.max(
    0,
    ...entryValues.map((entry) => entry.totalNLoadKg),
  )
  const nLoadScale = Math.max(
    1,
    maxNLoad,
    quotaKgn > 0 ? quotaKgn / QUOTA_LINE_POSITION : 0,
  )
  const quotaPct = quotaKgn > 0 ? (quotaKgn / nLoadScale) * 100 : null
  const selectedColumn =
    selectedPosition >= 0 ? columns[selectedPosition] : null
  const columnWidthPct = columns.length > 0 ? 100 / columns.length : 100
  const highlightLeftPct = lastSelectedPosition * columnWidthPct
  const hasSelectedColumn = selectedPosition >= 0
  const allYearsSelected = !hasSelectedColumn
  const collapsed = collapsible && !open
  const barBoxHeight = compact ? 'h-24' : 'h-28'
  const barAreaHeight = compact ? 'h-20' : 'h-24'
  const selectedEntry = loading ? null : (selectedColumn?.entry ?? null)
  const selectedRelation = selectedEntry
    ? describeQuotaRelation(selectedEntry.totalNLoadKg, quotaKgn)
    : null

  return (
    <section
      aria-label="Gennemgang af årrække"
      aria-busy={loading}
      className="shrink-0 rounded-lg border bg-card @container"
    >
      <div
        className={cn(
          'flex items-center gap-3 px-4 pt-3',
          collapsed ? 'pb-3' : 'pb-2',
        )}
      >
        <div className="flex shrink-0 items-center gap-3">
          {collapsible ? (
            <DisclosureButton
              open={open}
              onToggle={() => onOpenOverrideChange?.(!open)}
              aria-controls={bodyId}
              label="Årsgennemgang"
            />
          ) : (
            <h2 className="text-sm font-medium">Årsgennemgang</h2>
          )}
        </div>
        {collapsed ? (
          <>
            <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-0.5">
              <button
                type="button"
                aria-pressed={allYearsSelected}
                onClick={() => selectYear(null)}
                className={cn(
                  'flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  allYearsSelected
                    ? 'bg-card font-semibold text-foreground shadow-sm'
                    : 'font-medium text-muted-foreground hover:bg-background/80 hover:text-foreground',
                )}
              >
                Alle år
              </button>
              <div
                role="radiogroup"
                aria-label="Vælg år"
                onKeyDown={(event) => handleYearKeyDown(event, 'chips')}
                className="flex items-center gap-0.5"
              >
                {columns.map((column, position) => {
                  const isSelected = selectedYearIndex === column.index
                  const relation = column.entry
                    ? describeQuotaRelation(column.entry.totalNLoadKg, quotaKgn)
                    : null
                  const title = columnTitle(column, relation, loading, history)
                  const tabIndex =
                    isSelected || (selectedPosition < 0 && position === 0)
                      ? 0
                      : -1
                  return (
                    <button
                      key={column.index}
                      ref={(element) => {
                        chipRefs.current[position] = element
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={title}
                      title={title}
                      tabIndex={tabIndex}
                      onClick={() =>
                        selectYear(isSelected ? null : column.index)
                      }
                      className={cn(
                        'flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isSelected
                          ? 'bg-card font-semibold text-foreground shadow-sm'
                          : 'font-medium text-muted-foreground hover:bg-background/80 hover:text-foreground',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          loading
                            ? 'bg-muted-foreground/20 motion-safe:animate-pulse'
                            : QUOTA_STATUS_STYLES[
                                relation?.level ?? 'uncalculated'
                              ].dot,
                        )}
                      />
                      {column.calendarYear}
                    </button>
                  )
                })}
              </div>
            </div>
            {selectedEntry && selectedRelation ? (
              <div className="ml-auto hidden shrink-0 items-center gap-3 text-xs tabular-nums @2xl:flex">
                <span className="text-muted-foreground">
                  DB2{' '}
                  <span className="font-medium text-foreground">
                    {formatCompactKr(selectedEntry.totalDb2)}
                  </span>
                </span>
                <QuotaStatusIndicator
                  level={selectedRelation.level}
                  className={cn(
                    'flex-nowrap items-baseline',
                    QUOTA_STATUS_STYLES[selectedRelation.level].text,
                  )}
                >
                  {formatNLoadAmount(selectedEntry.totalNLoadKg, quotaKgn)} -{' '}
                  {selectedRelation.text}
                </QuotaStatusIndicator>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div
        id={bodyId}
        hidden={collapsed}
        className="flex flex-wrap gap-6 px-4 pb-4 @container"
      >
        <div className="flex shrink-0 items-center self-center">
          <Button
            variant={allYearsSelected ? 'secondary' : 'outline'}
            size="xs"
            aria-pressed={allYearsSelected}
            onClick={() => selectYear(null)}
          >
            Alle år
          </Button>
        </div>
        <div className="min-w-0 flex-1 basis-96">
          <div
            role="radiogroup"
            aria-label="Vælg år"
            className="p-0.5"
            onKeyDown={(event) => handleYearKeyDown(event, 'bars')}
          >
            {quotaKgn > 0 ? (
              <span className="sr-only">
                Grænse {formatWholeNumber(quotaKgn)} kg N pr. år
              </span>
            ) : null}
            <div className="relative">
              <div
                className={cn(
                  'absolute inset-y-0 z-0 rounded-lg bg-muted motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out',
                  allYearsSelected && 'opacity-0',
                )}
                style={{
                  left: `${highlightLeftPct}%`,
                  width: `${columnWidthPct}%`,
                }}
                aria-hidden="true"
              />
              {quotaPct !== null ? (
                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-0 top-4 z-20 motion-safe:animate-rise-in',
                    barAreaHeight,
                  )}
                  aria-hidden="true"
                >
                  <div
                    className="absolute inset-x-0 border-t border-dashed border-foreground/40 motion-safe:transition-[bottom] motion-safe:duration-300"
                    style={{ bottom: `${quotaPct}%` }}
                  >
                    <span className="absolute right-0 bottom-full mb-0.5 rounded bg-card/80 px-1 text-xs leading-tight text-muted-foreground">
                      grænse {formatWholeNumber(quotaKgn)} kg N pr. år
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="flex">
                {columns.map((column, position) => {
                  const isSelected = selectedYearIndex === column.index
                  const entry = column.entry
                  const relation = entry
                    ? describeQuotaRelation(entry.totalNLoadKg, quotaKgn)
                    : null
                  const nLoadPct = entry
                    ? barHeightPct(entry.totalNLoadKg, nLoadScale)
                    : 0
                  const barPct = loading
                    ? PLACEHOLDER_BAR_HEIGHTS[
                        position % PLACEHOLDER_BAR_HEIGHTS.length
                      ]
                    : nLoadPct
                  const barColor =
                    QUOTA_STATUS_STYLES[relation?.level ?? 'uncalculated'].dot
                  const title = columnTitle(column, relation, loading, history)
                  const tabIndex =
                    isSelected || (selectedPosition < 0 && position === 0)
                      ? 0
                      : -1
                  const dimmed = hasSelectedColumn && !isSelected
                  return (
                    <button
                      key={column.index}
                      ref={(element) => {
                        cellRefs.current[position] = element
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={title}
                      title={title}
                      tabIndex={tabIndex}
                      onClick={() =>
                        selectYear(isSelected ? null : column.index)
                      }
                      className="group relative z-10 flex min-w-0 flex-1 cursor-pointer flex-col items-center rounded-lg pb-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <span
                        className={cn(
                          'flex w-full items-end justify-center',
                          barBoxHeight,
                        )}
                        aria-hidden="true"
                      >
                        <span
                          className={cn(
                            'relative flex items-end justify-center',
                            barAreaHeight,
                          )}
                        >
                          {entry ? (
                            <span
                              className={cn(
                                'absolute left-1/2 mb-0.5 -translate-x-1/2 rounded bg-card/80 px-0.5 text-xs leading-tight whitespace-nowrap tabular-nums motion-safe:animate-rise-in motion-safe:transition-[color,bottom] motion-safe:duration-300',
                                isSelected
                                  ? 'font-medium text-foreground'
                                  : 'text-muted-foreground',
                              )}
                              style={{
                                bottom: `${nLoadPct}%`,
                                animationDelay: '200ms',
                              }}
                            >
                              {formatWholeNumber(entry.totalNLoadKg)}
                            </span>
                          ) : null}
                          <span
                            className={cn(
                              'w-5 rounded-t-xs motion-safe:transition-[height,opacity,background-color] motion-safe:duration-300',
                              loading
                                ? 'bg-muted-foreground/20 motion-safe:animate-pulse'
                                : barColor,
                              !loading && nLoadPct > 0 && 'min-h-0.5',
                              dimmed && 'opacity-60',
                            )}
                            style={{ height: `${barPct}%` }}
                          />
                        </span>
                      </span>
                      <span
                        className={cn(
                          'pt-1 text-xs tabular-nums motion-safe:transition-colors motion-safe:duration-300 @sm:text-sm',
                          isSelected
                            ? 'font-semibold text-foreground'
                            : 'text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        {column.calendarYear}
                      </span>
                      <span
                        className={cn(
                          'text-xs tabular-nums motion-safe:transition-colors motion-safe:duration-300',
                          isSelected
                            ? 'text-foreground'
                            : 'text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        {loading ? (
                          <span className="inline-block h-3 w-10 rounded bg-muted-foreground/20 motion-safe:animate-pulse" />
                        ) : entry ? (
                          formatCompactKr(entry.totalDb2)
                        ) : (
                          '-'
                        )}
                      </span>
                      <span
                        className={cn(
                          'mt-1 size-1.5 rounded-full bg-primary motion-safe:transition-opacity motion-safe:duration-300',
                          isSelected ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <YearSummaryBox
          loading={loading}
          column={selectedColumn}
          quotaKgn={quotaKgn}
          fieldCount={fields.length}
          totals={totals}
          catchmentOverview={catchmentOverview}
          lastRun={lastRun}
          overYears={overYears}
          yearCount={entryValues.length}
          history={history}
          unavailableMessage={unavailableMessage}
        />
      </div>
    </section>
  )
}
