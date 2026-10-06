import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import {
  BEST_TEXT_CLASS,
  columnCellClass,
  completeFigure,
  highlightHandlers,
  TABLE_HEAD_CLASS,
  type ComparedColumn,
  type OnHighlight,
} from '@/components/farm/comparison-column'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { EconomicsChip } from '@/components/farm/EconomicsChip'
import { GlossaryInfo, type GlossaryTerm } from '@/components/GlossaryInfo'
import { LoadError } from '@/components/ui/load-error'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { STANDARD_PROFILE } from '@/lib/economics-profiles'
import {
  formatCompactDkk,
  formatPerHa,
  QUOTA_STATUS_STYLES,
  totalsPerHa,
} from '@/lib/field-domain'
import {
  bestColumnIndex,
  COMPARISON_PERIOD,
  COMPARISON_SORT_LABELS,
  formatKgN,
  formatYears,
  formatYearsDelta,
  shareOfMax,
  type BestDirection,
  type ComparisonSort,
} from '@/lib/simulation-comparison'
import { describeDb2Delta, describeNLoadDelta } from '@/lib/simulation-overview'
import { cn } from '@/lib/utils'

type Metric = {
  key: Exclude<ComparisonSort, 'balance'>
  label: string
  term?: GlossaryTerm
  valueOf: (column: ComparedColumn) => number | null
  format: (value: number) => string
  total?: (column: ComparedColumn) => string
  describeDelta: (value: number, history: number) => string
  direction: BestDirection
  bestWord: string
  barClass: string
}

const METRICS: Metric[] = [
  {
    key: 'db2',
    label: 'Dækningsbidrag pr. år',
    valueOf: (column) => totalsPerHa(column.totals, 'db2'),
    format: (value) => formatPerHa(value, 'db2'),
    total: (column) => `${formatCompactDkk(column.totals.db2)} i alt`,
    describeDelta: (value, history) => describeDb2Delta(value, history).text,
    direction: 'highest',
    bestWord: 'højest',
    barClass: 'bg-primary',
  },
  {
    key: 'nLoad',
    label: 'Udledning pr. år',
    term: 'nLoad',
    valueOf: (column) => totalsPerHa(column.totals, 'nLoad'),
    format: (value) => formatPerHa(value, 'nLoad'),
    total: (column) => `${formatKgN(column.totals.nLoad)} i alt`,
    describeDelta: (value, history) => describeNLoadDelta(value, history).text,
    direction: 'lowest',
    bestWord: 'lavest',
    barClass: 'bg-[#8F8F89]',
  },
  {
    key: 'yearsOver',
    label: 'År over kvoten',
    valueOf: (column) => column.yearsOver,
    format: formatYears,
    describeDelta: (value, history) => formatYearsDelta(value - history),
    direction: 'lowest',
    bestWord: 'færrest',
    barClass: QUOTA_STATUS_STYLES.over.dot,
  },
]

type MetricCellProps = {
  metric: Metric
  column: ComparedColumn
  history: ComparedColumn
  best: boolean
  max: number
  catchmentCount: number
}

const MetricCell = ({
  metric,
  column,
  history,
  best,
  max,
  catchmentCount,
}: MetricCellProps) => {
  const value = metric.valueOf(column)
  if (value === null) {
    return metric.key === 'yearsOver' && column.catchments === undefined ? (
      <LoadError
        message="Kunne ikke hente tallene."
        onRetry={column.onRetry}
        retrying={column.retrying}
      />
    ) : (
      <span className="text-sm text-muted-foreground">Ingen tal</span>
    )
  }
  const historyValue = metric.valueOf(history)
  return (
    <>
      <span
        className={cn(
          'block font-display text-2xl leading-tight tabular-nums',
          best && BEST_TEXT_CLASS,
        )}
      >
        {metric.format(value)}
      </span>
      {metric.total ? (
        <span className="block text-xs text-muted-foreground tabular-nums">
          {metric.total(column)}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          'mt-2 block h-1.5 overflow-hidden rounded-full',
          column.history ? 'bg-[#E8E4D8]' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'block h-full rounded-full',
            column.history ? 'bg-[#B8B3A6]' : metric.barClass,
          )}
          style={{ width: `${shareOfMax(value, max)}%` }}
        />
      </span>
      {column.history ? (
        metric.key === 'yearsOver' && column.catchmentsOver !== null ? (
          <span className="mt-1.5 block text-xs text-muted-foreground">
            {column.catchmentsOver > 0
              ? `over kvoten i ${column.catchmentsOver} af ${catchmentCount} ${catchmentCount === 1 ? 'opland' : 'oplande'}`
              : 'under kvoten i alle oplande'}
          </span>
        ) : null
      ) : (
        <span className="mt-1.5 block text-xs text-muted-foreground">
          {historyValue === null
            ? null
            : metric.describeDelta(value, historyValue)}
          {best ? (
            <>
              {historyValue === null ? null : ' · '}
              <span className={cn('font-semibold', BEST_TEXT_CLASS)}>
                {metric.bestWord}
              </span>
            </>
          ) : null}
        </span>
      )}
    </>
  )
}

type SortButtonProps = {
  sort: ComparisonSort
  active: boolean
  onSortChange: (sort: ComparisonSort) => void
  children: ReactNode
}

const SortButton = ({
  sort,
  active,
  onSortChange,
  children,
}: SortButtonProps) => (
  <button
    type="button"
    title={`Sorter efter ${COMPARISON_SORT_LABELS[sort]}`}
    onClick={() => onSortChange(sort)}
    className={cn(
      'rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      active
        ? 'font-semibold text-foreground'
        : 'text-muted-foreground hover:text-foreground',
    )}
  >
    {children}
  </button>
)

type ComparisonRankingProps = {
  columns: ComparedColumn[]
  bestBalanceKey: string | null
  catchmentCount: number
  sort: ComparisonSort
  onSortChange: (sort: ComparisonSort) => void
  highlightedKey: string | null
  onHighlight: OnHighlight
}

export const ComparisonRanking = ({
  columns,
  bestBalanceKey,
  catchmentCount,
  sort,
  onSortChange,
  highlightedKey,
  onHighlight,
}: ComparisonRankingProps) => {
  const economics = useEconomicsProfiles()
  const { search } = useLocation()
  const [history, ...simulations] = columns
  const sortable = simulations.length > 1
  const bestIndexes = METRICS.map((metric) =>
    bestColumnIndex(
      columns.map((column) => completeFigure(column, metric.valueOf(column))),
      metric.direction,
      metric.format,
    ),
  )
  const maxes = METRICS.map((metric) =>
    Math.max(1, ...columns.map((column) => metric.valueOf(column) ?? 0)),
  )
  return (
    <Table
      containerClassName="rounded-lg border bg-card"
      className="table-fixed"
    >
      <colgroup>
        <col className="w-70" />
        {METRICS.map((metric) => (
          <col key={metric.key} />
        ))}
      </colgroup>
      <TableHeader className={TABLE_HEAD_CLASS}>
        <TableRow className="hover:bg-transparent">
          <TableHead
            scope="col"
            aria-sort={sortable && sort === 'balance' ? 'other' : undefined}
            className="h-auto px-4.5 py-2.5 text-xs font-normal text-muted-foreground"
          >
            {sortable ? (
              <SortButton
                sort="balance"
                active={sort === 'balance'}
                onSortChange={onSortChange}
              >
                Simulering · sorteret efter {COMPARISON_SORT_LABELS[sort]}
              </SortButton>
            ) : (
              'Simulering'
            )}
          </TableHead>
          {METRICS.map((metric) => (
            <TableHead
              key={metric.key}
              scope="col"
              aria-sort={
                sortable && sort === metric.key
                  ? metric.direction === 'highest'
                    ? 'descending'
                    : 'ascending'
                  : undefined
              }
              className="h-auto px-0 py-2.5 text-xs font-normal text-muted-foreground"
            >
              <span className="inline-flex items-center gap-1">
                {sortable ? (
                  <SortButton
                    sort={metric.key}
                    active={sort === metric.key}
                    onSortChange={onSortChange}
                  >
                    {metric.label}
                    {sort === metric.key ? ' ▾' : null}
                  </SortButton>
                ) : (
                  metric.label
                )}
                {metric.term ? <GlossaryInfo term={metric.term} /> : null}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((column, index) => (
          <TableRow
            key={column.key}
            className={cn(
              'hover:bg-transparent',
              column.history
                ? 'border-b-[#D6CFBC] border-dashed'
                : 'border-border/60',
            )}
            {...(column.history
              ? {}
              : highlightHandlers(column.key, onHighlight))}
          >
            <TableHead
              scope="row"
              className={cn(
                'h-auto px-4.5 py-3 align-top font-normal whitespace-normal transition-colors duration-120',
                columnCellClass(column, highlightedKey),
              )}
            >
              <span className="block font-display text-[19px] leading-tight">
                {column.title}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {column.history
                  ? `Udgangspunkt · fremskrevet til ${COMPARISON_PERIOD}`
                  : column.subtitle}
              </span>
              {column.key === bestBalanceKey && simulations.length > 1 ? (
                <span
                  className={cn(
                    'mt-1 block text-xs font-semibold',
                    BEST_TEXT_CLASS,
                  )}
                >
                  Bedste balance
                </span>
              ) : null}
              <EconomicsChip
                className="mt-2"
                profile={
                  column.history
                    ? STANDARD_PROFILE
                    : economics.profileForSimulation(column.key)
                }
                returnTo={{ kind: 'compare', search }}
              />
            </TableHead>
            {METRICS.map((metric, metricIndex) => (
              <TableCell
                key={metric.key}
                className={cn(
                  'px-0 py-3 pr-8 align-top whitespace-normal transition-colors duration-120',
                  columnCellClass(column, highlightedKey),
                )}
              >
                <MetricCell
                  metric={metric}
                  column={column}
                  history={history}
                  best={!column.history && bestIndexes[metricIndex] === index}
                  max={maxes[metricIndex]}
                  catchmentCount={catchmentCount}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
