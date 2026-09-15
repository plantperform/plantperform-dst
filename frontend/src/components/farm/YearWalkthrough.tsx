import { useMemo, useRef, type KeyboardEvent } from 'react'
import { CalendarRange } from 'lucide-react'

import type {
  FieldRecord,
  OptimizeSimulationResponse,
  YearlySummaryEntry,
} from '@/api/types'
import { catchmentKey } from '@/components/farm/catchment-options'
import { CHOICE_SELECTED_CLASS } from '@/components/farm/choice-styles'
import { Skeleton } from '@/components/ui/skeleton'
import { useViewportShorterThan } from '@/hooks/use-viewport-height'
import {
  formatCompactDkk,
  formatFieldCount,
  formatNumber,
  formatQuotaAmount,
  formatQuotaPercent,
  formatWholeNumber,
  QUOTA_STATUS_LABELS,
  QUOTA_STATUS_STYLES,
  quotaStatusLevel,
  REAL_HISTORY_START_CALENDAR_YEAR,
  resolveFarmQuota,
  ROTATION_CALENDAR_YEARS,
  ROTATION_START_CALENDAR_YEAR,
  type CatchmentQuota,
  type FarmQuota,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const PLACEHOLDER_BAR_HEIGHTS = [34, 46, 28, 52, 38, 48, 32, 44]

const COMPACT_VIEWPORT_HEIGHT = 960

const QUOTA_LINE_PCT = 34

const RUN_STATUS_LABELS: Record<OptimizeSimulationResponse['status'], string> =
  {
    OPTIMAL: 'optimal løsning',
    FEASIBLE: 'brugbar løsning, tidsgrænsen blev nået',
  }

type YearColumn = {
  index: number
  calendarYear: number
  entry: YearlySummaryEntry | null
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

export type CatchmentNLoadByYear = Record<number, Record<string, number>>

type CatchmentYear = {
  catchment: CatchmentQuota
  nLoadKg: number
  quotaKgN: number
  level: QuotaStatusLevel
}

const barWidthClass = (count: number): string =>
  count > 6 ? 'w-1.5' : count > 4 ? 'w-2.5' : count > 3 ? 'w-3' : 'w-4'

const describeCatchmentYear = (label: string, row: CatchmentYear): string =>
  `${label}: ${formatQuotaAmount(row.nLoadKg, row.quotaKgN, formatWholeNumber)}${
    row.quotaKgN > 0
      ? ` (${formatQuotaPercent(row.nLoadKg, row.quotaKgN)})`
      : ', ingen kvote'
  }`

type QuotaBarProps = {
  row: CatchmentYear
  title: string
  colorClass: string
  widthClass: string
}

const QuotaBar = ({ row, title, colorClass, widthClass }: QuotaBarProps) => {
  if (row.quotaKgN === 0) return null
  const ratio = row.nLoadKg / row.quotaKgN
  const heightPct = Math.min(100, ratio * QUOTA_LINE_PCT)
  const overPct =
    ratio > 1 ? ((heightPct - QUOTA_LINE_PCT) / heightPct) * 100 : 0
  return (
    <span
      title={title}
      className={cn(
        'relative z-10 flex flex-col overflow-hidden rounded-t-[3px] motion-safe:transition-[height] motion-safe:duration-300',
        widthClass,
        colorClass,
        heightPct > 0 && 'min-h-0.5',
      )}
      style={{ height: `${heightPct}%` }}
    >
      {overPct > 0 ? (
        <span className="bg-red-600" style={{ height: `${overPct}%` }} />
      ) : null}
    </span>
  )
}

const ScopedFact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-[11px] text-muted-foreground">{label}</dt>
    <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
  </div>
)

type ScopedSummaryProps = {
  row: CatchmentYear
  column: YearColumn | null
  db2: number
  yearFieldCount: number | null
  overYearCount: number
  yearCount: number
}

const ScopedSummary = ({
  row,
  column,
  db2,
  yearFieldCount,
  overYearCount,
  yearCount,
}: ScopedSummaryProps) => {
  const style = QUOTA_STATUS_STYLES[row.level]
  const { fieldCount, areaHa } = row.catchment.totals
  const difference = formatWholeNumber(Math.abs(row.nLoadKg - row.quotaKgN))
  const over = row.nLoadKg > row.quotaKgN
  return (
    <div className="flex flex-col gap-3 border-t pt-2.5">
      <div className="flex flex-col gap-1">
        <div className={cn('flex items-baseline gap-2', style.text)}>
          <span className="font-display text-3xl leading-none tabular-nums">
            {formatQuotaPercent(row.nLoadKg, row.quotaKgN)}
          </span>
          <span className="text-xs font-medium">
            {QUOTA_STATUS_LABELS[row.level].toLowerCase()}
          </span>
        </div>
        <p className="text-xs text-pretty text-muted-foreground tabular-nums">
          {formatQuotaAmount(row.nLoadKg, row.quotaKgN, formatWholeNumber)}
          {over
            ? `, skal ned med ${difference} kg N`
            : `, ${difference} kg N tilbage`}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-2.5">
        <ScopedFact
          label="Marker"
          value={`${formatFieldCount(fieldCount)} · ${formatNumber(areaHa)} ha`}
        />
        <ScopedFact
          label="Kvote pr. ha"
          value={
            areaHa > 0
              ? `${formatNumber(row.quotaKgN / areaHa)} kg N/ha`
              : '-'
          }
        />
        <ScopedFact
          label={column ? 'DB2' : 'DB2 gns. pr. år'}
          value={formatCompactDkk(db2)}
        />
        {column ? (
          <ScopedFact
            label="Marker med data"
            value={`${yearFieldCount ?? 0} af ${fieldCount}`}
          />
        ) : (
          <ScopedFact
            label="År over kvoten"
            value={`${overYearCount} af ${yearCount}`}
          />
        )}
      </dl>
    </div>
  )
}

type PanelRowProps = {
  row: CatchmentYear
  label: string
  colorClass: string
}

const PanelRow = ({ row, label, colorClass }: PanelRowProps) => {
  const style = QUOTA_STATUS_STYLES[row.level]
  const calculated = row.level !== 'uncalculated'
  const hasQuota = row.quotaKgN > 0
  return (
    <div className="flex items-start justify-between gap-3 border-t py-2">
      <span className="flex min-w-0 items-start gap-2">
        <span
          aria-hidden="true"
          className={cn('mt-[5px] size-2.5 shrink-0 rounded-[3px]', colorClass)}
        />
        <span className="min-w-0">
          <span className="block text-[13px] leading-5 text-pretty">
            {label}
          </span>
          <span className="block text-[11px] leading-4 text-muted-foreground tabular-nums">
            {!calculated
              ? 'ikke beregnet'
              : `${formatQuotaAmount(row.nLoadKg, row.quotaKgN, formatWholeNumber)}${hasQuota ? '' : ', ingen kvote'}`}
          </span>
        </span>
      </span>
      {calculated && hasQuota ? (
        <span
          className={cn(
            'shrink-0 text-[13px] leading-5 font-semibold tabular-nums',
            style.text,
          )}
        >
          {formatQuotaPercent(row.nLoadKg, row.quotaKgN)}
        </span>
      ) : null}
    </div>
  )
}

type YearPanelProps = {
  loading: boolean
  column: YearColumn | null
  rows: CatchmentYear[]
  quota: FarmQuota
  scopeLabel: string | null
  catchmentLabel: (catchmentId: number | null) => string
  catchmentColor: (catchmentId: number | null) => string
  yearCount: number
  overYearCount: number
  fieldCount: number
  lastRun: OptimizeSimulationResponse | null
  history: boolean
  unavailableMessage: string | null
}

const YearPanel = ({
  loading,
  column,
  rows,
  quota,
  scopeLabel,
  catchmentLabel,
  catchmentColor,
  yearCount,
  overYearCount,
  fieldCount,
  lastRun,
  history,
  unavailableMessage,
}: YearPanelProps) => {
  const entry = column?.entry ?? null
  const scoped = scopeLabel !== null
  const pending =
    column !== null ? entry === null : quota.level === 'uncalculated'
  const hasQuota = rows.some((row) => row.quotaKgN > 0)
  const scopedRow =
    scoped &&
    !pending &&
    rows.length === 1 &&
    rows[0].quotaKgN > 0 &&
    rows[0].level !== 'uncalculated'
      ? rows[0]
      : null

  const title = column
    ? String(column.calendarYear)
    : (scopeLabel ?? (yearCount > 0 ? `Alle ${yearCount} år` : 'Alle år'))
  const subtitle = pending
    ? column
      ? 'Ingen årstal for året'
      : 'Ikke beregnet endnu'
    : column
      ? scoped
        ? `${scopeLabel} mod sin kvote`
        : 'Udledning mod hvert oplands kvote'
      : scoped
        ? 'Gennemsnit pr. år mod kvoten'
        : 'Gennemsnit pr. år mod hvert oplands kvote'

  const pendingNote = column
    ? history
      ? `Ingen historik for ${column.calendarYear}.`
      : `Ingen årstal for ${column.calendarYear} endnu - kør Optimér for at beregne markerne.`
    : history
      ? 'Ingen marker er beregnet endnu.'
      : 'Kør Optimér for at beregne markerne.'
  const message = pending
    ? (unavailableMessage ?? pendingNote)
    : !hasQuota
      ? 'Markerne har ingen udledningsgrænse.'
      : column
        ? null
        : unavailableMessage

  return (
    <aside
      aria-label="Oversigt over årene"
      className="flex max-w-full min-w-72 flex-[1_1_18rem] flex-col rounded-2xl border bg-card px-4 pt-3.5 pb-3"
    >
      <div
        key={loading ? 'loading' : (column?.index ?? 'all')}
        role="status"
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-2.5 motion-safe:animate-rise-in"
      >
        {loading ? (
          <>
            <span className="sr-only">Indlæser årstal</span>
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-40" />
            <div className="space-y-2 pt-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-1.5 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              <h3 className="font-display text-xl leading-tight font-normal">
                {title}
              </h3>
              <p className="text-xs text-pretty text-muted-foreground">
                {subtitle}
              </p>
            </div>

            <div className="relative min-h-24 flex-1">
              <div className="absolute inset-0 -mr-1.5 flex flex-col overflow-y-auto pr-1.5">
                {message ? (
                  <p className="pb-1.5 text-[11px] leading-4 text-pretty text-muted-foreground">
                    {message}
                  </p>
                ) : null}
                {scopedRow ? (
                  <ScopedSummary
                    row={scopedRow}
                    column={column}
                    db2={entry ? entry.totalDb2 : quota.totals.db2}
                    yearFieldCount={entry?.fieldCount ?? null}
                    overYearCount={overYearCount}
                    yearCount={yearCount}
                  />
                ) : !pending ? (
                  rows.map((row) => (
                    <PanelRow
                      key={row.catchment.catchmentId}
                      row={row}
                      label={catchmentLabel(row.catchment.catchmentId)}
                      colorClass={catchmentColor(row.catchment.catchmentId)}
                    />
                  ))
                ) : null}
                {!scopedRow && entry && entry.fieldCount < fieldCount ? (
                  <p className="border-t pt-1.5 text-[11px] leading-4 text-muted-foreground">
                    Kun {entry.fieldCount} af {fieldCount} marker har data for
                    året.
                  </p>
                ) : null}
                {lastRun && !column ? (
                  <p className="border-t pt-1.5 text-[11px] leading-4 text-muted-foreground">
                    Sidste kørsel: {RUN_STATUS_LABELS[lastRun.status]} - DB2{' '}
                    {formatCompactDkk(lastRun.objectiveDb2)}, udledning{' '}
                    {formatWholeNumber(lastRun.totalNLoadKg)} kg N, udvaskning{' '}
                    {formatWholeNumber(lastRun.totalLeachingKg)} kg N,{' '}
                    {formatWholeNumber(lastRun.totalFeedUnits)} FE
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

type YearWalkthroughProps = {
  entries: YearlySummaryEntry[] | undefined
  loading: boolean
  fields: FieldRecord[]
  selectedYearIndex: number | null
  onSelectedYearIndexChange: (index: number | null) => void
  catchmentLabel: (catchmentId: number | null) => string
  catchmentColor: (catchmentId: number | null) => string
  lastRun: OptimizeSimulationResponse | null
  history?: boolean
  unavailableMessage?: string | null
  scopeLabel?: string | null
  catchmentNLoadByYear?: CatchmentNLoadByYear
}

export const YearWalkthrough = ({
  entries,
  loading,
  fields,
  selectedYearIndex,
  onSelectedYearIndexChange,
  catchmentLabel,
  catchmentColor,
  lastRun,
  history = false,
  unavailableMessage = null,
  scopeLabel = null,
  catchmentNLoadByYear,
}: YearWalkthroughProps) => {
  const compact = useViewportShorterThan(COMPACT_VIEWPORT_HEIGHT)
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([])

  const columns = useMemo(
    () => buildColumns(loading ? undefined : entries, history),
    [entries, loading, history],
  )
  const quota = useMemo(
    () => resolveFarmQuota(fields, !history),
    [fields, history],
  )
  const catchments = quota.catchments
  const quotaCatchmentCount = catchments.filter(
    (catchment) => catchment.totals.nLoadQuotaKgN > 0,
  ).length

  const catchmentYears = (entry: YearlySummaryEntry | null): CatchmentYear[] =>
    catchments.map((catchment) => {
      const quotaKgN = catchment.totals.nLoadQuotaKgN
      if (entry === null) {
        return {
          catchment,
          nLoadKg: catchment.totals.nLoad,
          quotaKgN,
          level: catchment.level,
        }
      }
      const nLoadKg =
        catchmentNLoadByYear?.[entry.year]?.[
          catchmentKey(catchment.catchmentId)
        ] ?? 0
      return {
        catchment,
        nLoadKg,
        quotaKgN,
        level: quotaStatusLevel(nLoadKg, quotaKgN, true),
      }
    })

  const selectedPosition = columns.findIndex(
    (column) => column.index === selectedYearIndex,
  )
  const lastPosition = columns.length - 1
  const selectedColumn =
    selectedPosition >= 0 ? columns[selectedPosition] : null
  const allYearsSelected = selectedColumn === null

  const selectYear = (index: number | null) => {
    onSelectedYearIndexChange(index)
  }

  const moveTo = (position: number) => {
    const clamped = Math.max(0, Math.min(lastPosition, position))
    selectYear(columns[clamped].index)
    cellRefs.current[clamped]?.focus()
  }

  const handleYearKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (columns.length === 0) return
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveTo(selectedPosition < 0 ? 0 : selectedPosition + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveTo(selectedPosition < 0 ? lastPosition : selectedPosition - 1)
        break
      case 'Home':
        event.preventDefault()
        moveTo(0)
        break
      case 'End':
        event.preventDefault()
        moveTo(lastPosition)
        break
      case 'Escape':
        event.preventDefault()
        selectYear(null)
        break
      default:
        break
    }
  }

  const yearCount = columns.filter((column) => column.entry !== null).length
  const overYearCount = columns.filter(
    (column) =>
      column.entry !== null &&
      catchmentYears(column.entry).some((row) => row.level === 'over'),
  ).length
  const barAreaHeight = compact ? 'h-24' : 'h-[124px]'
  const barWidth = barWidthClass(catchments.length)
  const periodLabel =
    columns.length > 0
      ? `${columns[0].calendarYear}-${columns[columns.length - 1].calendarYear}`
      : ''
  const chartHint = scopeLabel
    ? `Kun ${scopeLabel} · stiplet linje er oplandets kvote`
    : 'Hvert opland mod sin egen kvote'

  return (
    <div className="flex min-w-0 flex-1 basis-[36rem] flex-wrap gap-3">
      <section
        aria-label="Gennemgang af årrække"
        aria-busy={loading}
        className="flex min-w-0 flex-[2_1_28rem] flex-col gap-3 rounded-2xl border bg-card px-4.5 pt-3.5 pb-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 className="text-[13px] font-semibold">Årsgennemgang</h2>
            <p className="truncate text-xs text-muted-foreground">
              {chartHint}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
            {catchments.map((catchment) => (
              <span
                key={catchment.catchmentId}
                className="inline-flex min-w-0 items-center gap-1.5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-2 w-3 shrink-0 rounded-[2px]',
                    catchmentColor(catchment.catchmentId),
                  )}
                />
                <span className="max-w-40 truncate">
                  {catchmentLabel(catchment.catchmentId)}
                </span>
              </span>
            ))}
            {quotaCatchmentCount > 0 ? (
              <>
                {quotaCatchmentCount === 1 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="w-3.5 border-t-[1.5px] border-dashed border-foreground/50"
                    />
                    Oplandets kvote
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-3 rounded-[2px] bg-red-600"
                  />
                  Over kvoten
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-3.5">
          <button
            type="button"
            aria-pressed={allYearsSelected}
            title="Vis alle år samlet"
            onClick={() => selectYear(null)}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              allYearsSelected
                ? cn(CHOICE_SELECTED_CLASS, 'text-secondary-foreground')
                : 'bg-card text-muted-foreground hover:bg-muted',
            )}
          >
            <CalendarRange className="size-[18px]" aria-hidden="true" />
            <span className="text-xs font-semibold">Alle år</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {periodLabel}
            </span>
          </button>

          <div className="min-w-0">
            <div
              role="radiogroup"
              aria-label="Vælg år"
              onKeyDown={handleYearKeyDown}
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`,
              }}
            >
              {columns.map((column, position) => {
                const isSelected = selectedYearIndex === column.index
                const entry = column.entry
                const rows = entry ? catchmentYears(entry) : []
                const overCount = rows.filter(
                  (row) => row.level === 'over',
                ).length
                const overLabel =
                  entry && overCount > 0 ? `${overCount} over` : null
                const title = loading
                  ? `${column.calendarYear}: indlæser årstal`
                  : !entry
                    ? history
                      ? `${column.calendarYear}: ingen historik`
                      : `${column.calendarYear}: ingen årstal endnu`
                    : `${column.calendarYear}: DB2 ${formatCompactDkk(entry.totalDb2)}, udledning ${formatWholeNumber(entry.totalNLoadKg)} kg N${
                        quotaCatchmentCount > 0
                          ? overCount > 0
                            ? `, ${overCount} af ${quotaCatchmentCount} oplande over kvoten`
                            : ', alle oplande under kvoten'
                          : ''
                      }`
                const tabIndex =
                  isSelected || (selectedPosition < 0 && position === 0)
                    ? 0
                    : -1
                const dimmed = selectedPosition >= 0 && !isSelected
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
                    onClick={() => selectYear(isSelected ? null : column.index)}
                    className={cn(
                      'flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-md border px-1 pt-1.5 pb-[7px] transition-[background-color,border-color,opacity] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      isSelected
                        ? 'border-primary bg-muted'
                        : 'border-transparent hover:bg-muted/60',
                      dimmed && 'opacity-45',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap tabular-nums',
                        QUOTA_STATUS_STYLES.over.text,
                      )}
                    >
                      {loading ? (
                        <span className="h-3 w-10 rounded bg-muted-foreground/20 motion-safe:animate-pulse" />
                      ) : overLabel ? (
                        <>
                          <span
                            aria-hidden="true"
                            className={cn(
                              'size-1.5 rounded-full',
                              QUOTA_STATUS_STYLES.over.dot,
                            )}
                          />
                          {overLabel}
                        </>
                      ) : null}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'relative flex w-full items-end justify-center gap-1 border-b border-border/70',
                        barAreaHeight,
                      )}
                    >
                      {quotaCatchmentCount === 1 ? (
                        <span
                          className="pointer-events-none absolute inset-x-0 z-20 border-t-[1.5px] border-dashed border-foreground/45"
                          style={{ bottom: `${QUOTA_LINE_PCT}%` }}
                        />
                      ) : null}
                      {loading
                        ? catchments.map((catchment, index) => (
                            <span
                              key={catchment.catchmentId}
                              className={cn(
                                'rounded-t-[3px] bg-muted-foreground/20 motion-safe:animate-pulse',
                                barWidth,
                              )}
                              style={{
                                height: `${PLACEHOLDER_BAR_HEIGHTS[(position + index) % PLACEHOLDER_BAR_HEIGHTS.length]}%`,
                              }}
                            />
                          ))
                        : rows.map((row) => (
                            <QuotaBar
                              key={row.catchment.catchmentId}
                              row={row}
                              title={`${column.calendarYear} · ${describeCatchmentYear(
                                catchmentLabel(row.catchment.catchmentId),
                                row,
                              )}`}
                              colorClass={catchmentColor(
                                row.catchment.catchmentId,
                              )}
                              widthClass={barWidth}
                            />
                          ))}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'text-[13px] font-semibold tabular-nums',
                        isSelected ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {column.calendarYear}
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-[11px] whitespace-nowrap text-muted-foreground tabular-nums"
                    >
                      {loading ? (
                        <span className="inline-block h-3 w-10 rounded bg-muted-foreground/20 motion-safe:animate-pulse" />
                      ) : entry ? (
                        `DB2 ${formatCompactDkk(entry.totalDb2)}`
                      ) : (
                        '-'
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <YearPanel
        loading={loading}
        column={selectedColumn}
        rows={
          selectedColumn === null
            ? catchmentYears(null)
            : selectedColumn.entry
              ? catchmentYears(selectedColumn.entry)
              : []
        }
        quota={quota}
        scopeLabel={scopeLabel}
        catchmentLabel={catchmentLabel}
        catchmentColor={catchmentColor}
        yearCount={yearCount}
        overYearCount={overYearCount}
        fieldCount={fields.length}
        lastRun={lastRun}
        history={history}
        unavailableMessage={unavailableMessage}
      />
    </div>
  )
}
