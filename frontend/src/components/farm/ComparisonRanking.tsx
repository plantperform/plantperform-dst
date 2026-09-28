import type { ReactNode } from 'react'

import {
  BEST_TEXT_CLASS,
  columnFigure,
  completeFigure,
  HISTORY_CELL_CLASS,
  TABLE_HEAD_CLASS,
  type ComparedColumn,
} from '@/components/farm/comparison-column'
import { GlossaryInfo } from '@/components/GlossaryInfo'
import { LoadError } from '@/components/ui/load-error'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCompactDkk, QUOTA_STATUS_STYLES } from '@/lib/field-domain'
import {
  bestColumnIndex,
  COMPARISON_PERIOD,
  formatDkkDelta,
  formatKgN,
  formatYears,
  formatYearsDelta,
  shareOfMax,
  type BestDirection,
} from '@/lib/simulation-comparison'
import { describeNLoadDelta } from '@/lib/simulation-overview'
import { cn } from '@/lib/utils'

type Metric = {
  key: string
  label: ReactNode
  valueOf: (column: ComparedColumn) => number | null
  format: (value: number) => string
  describeDelta: (value: number, history: number) => string
  direction: BestDirection
  bestWord: string
  barClass: string
}

const METRICS: Metric[] = [
  {
    key: 'db2',
    label: 'Dækningsbidrag pr. år',
    valueOf: (column) => columnFigure(column, column.totals.db2),
    format: formatCompactDkk,
    describeDelta: (value, history) => formatDkkDelta(value - history, value),
    direction: 'highest',
    bestWord: 'højest',
    barClass: 'bg-primary',
  },
  {
    key: 'nLoad',
    label: (
      <span className="inline-flex items-center gap-1">
        Udledning pr. år
        <GlossaryInfo term="nLoad" />
      </span>
    ),
    valueOf: (column) => columnFigure(column, column.totals.nLoad),
    format: formatKgN,
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

type ComparisonRankingProps = {
  columns: ComparedColumn[]
  bestBalanceKey: string | null
  catchmentCount: number
}

export const ComparisonRanking = ({
  columns,
  bestBalanceKey,
  catchmentCount,
}: ComparisonRankingProps) => {
  const [history, ...simulations] = columns
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
          <TableHead className="h-auto px-4.5 py-2.5 text-xs font-normal text-muted-foreground">
            {simulations.length > 1
              ? 'Simulering · sorteret efter bedste balance'
              : 'Simulering'}
          </TableHead>
          {METRICS.map((metric) => (
            <TableHead
              key={metric.key}
              scope="col"
              className="h-auto px-0 py-2.5 text-xs font-normal text-muted-foreground"
            >
              {metric.label}
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
                ? cn(HISTORY_CELL_CLASS, 'border-b-[#D6CFBC] border-dashed')
                : 'border-border/60',
            )}
          >
            <TableHead
              scope="row"
              className="h-auto px-4.5 py-3 align-top font-normal whitespace-normal"
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
            </TableHead>
            {METRICS.map((metric, metricIndex) => (
              <TableCell
                key={metric.key}
                className="px-0 py-3 pr-8 align-top whitespace-normal"
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
