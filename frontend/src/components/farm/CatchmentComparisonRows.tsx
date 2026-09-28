import { CatchmentYearBars } from '@/components/farm/CatchmentYearBars'
import {
  ComparisonCell,
  ComparisonRowHeader,
  ComparisonValue,
} from '@/components/farm/ComparisonTableParts'
import { CatchmentYearStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { TableRow } from '@/components/ui/table'
import {
  formatWholeNumber,
  QUOTA_STATUS_LABELS,
  type CatchmentTotalsByYear,
} from '@/lib/field-domain'
import {
  bestColumnIndex,
  formatKgN,
  listComparedCatchments,
  summarizeCatchmentComparison,
  type CatchmentComparison,
} from '@/lib/simulation-comparison'

export type CatchmentColumn = {
  key: string
  catchments: CatchmentTotalsByYear | undefined
  partialQuotas: ReadonlyMap<number, number>
  failed: boolean
  retrying: boolean
  onRetry: () => void
}

type ColumnStateProps = {
  column: CatchmentColumn
}

const ColumnState = ({ column }: ColumnStateProps) =>
  column.failed ? (
    <LoadError
      message="Kunne ikke hente tallene."
      onRetry={column.onRetry}
      retrying={column.retrying}
    />
  ) : (
    <Skeleton className="h-24 w-full" />
  )

type CatchmentFiguresProps = {
  comparison: CatchmentComparison
  best: boolean
}

const CatchmentFigures = ({ comparison, best }: CatchmentFiguresProps) => (
  <div className="flex flex-col gap-2">
    {comparison.average ? (
      <div>
        <ComparisonValue
          text={formatKgN(comparison.average.nLoadKg)}
          best={best}
        />
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatWholeNumber(comparison.average.quotaPct)} % af kvoten
        </span>
      </div>
    ) : null}
    <CatchmentYearStatusIndicator
      status={comparison.status}
      className="w-fit"
    />
    {comparison.average ? <CatchmentYearBars years={comparison.years} /> : null}
  </div>
)

type CatchmentRowProps = {
  catchmentId: number
  label: string
  columns: CatchmentColumn[]
  quotaKgN: number | undefined
}

const CatchmentRow = ({
  catchmentId,
  label,
  columns,
  quotaKgN,
}: CatchmentRowProps) => {
  const comparisons = columns.map((column) =>
    column.catchments === undefined
      ? undefined
      : summarizeCatchmentComparison(
          catchmentId,
          column.catchments,
          column.partialQuotas.get(catchmentId),
        ),
  )
  const best = bestColumnIndex(
    comparisons.map((comparison) =>
      comparison?.complete ? (comparison.average?.nLoadKg ?? null) : null,
    ),
    'lowest',
    formatKgN,
  )
  return (
    <TableRow className="hover:bg-transparent">
      <ComparisonRowHeader
        note={quotaKgN === undefined ? null : `Kvote ${formatKgN(quotaKgN)}`}
      >
        {label}
      </ComparisonRowHeader>
      {columns.map((column, index) => {
        const comparison = comparisons[index]
        return (
          <ComparisonCell key={column.key}>
            {comparison === undefined ? (
              <ColumnState column={column} />
            ) : comparison === null ? (
              <span className="text-sm text-muted-foreground">
                {QUOTA_STATUS_LABELS.noData}
              </span>
            ) : (
              <CatchmentFigures comparison={comparison} best={index === best} />
            )}
          </ComparisonCell>
        )
      })}
    </TableRow>
  )
}

type CatchmentComparisonRowsProps = {
  columns: CatchmentColumn[]
  catchmentLabel: (catchmentId: number) => string
  quotaByCatchment: ReadonlyMap<number, number>
}

export const CatchmentComparisonRows = ({
  columns,
  catchmentLabel,
  quotaByCatchment,
}: CatchmentComparisonRowsProps) => {
  const catchments = listComparedCatchments(columns, catchmentLabel)
  if (catchments.length === 0) {
    if (columns.every((column) => column.catchments !== undefined)) {
      return null
    }
    return (
      <TableRow className="hover:bg-transparent">
        <ComparisonRowHeader>Kystvandoplande</ComparisonRowHeader>
        {columns.map((column) => (
          <ComparisonCell key={column.key}>
            {column.catchments === undefined ? (
              <ColumnState column={column} />
            ) : null}
          </ComparisonCell>
        ))}
      </TableRow>
    )
  }
  return (
    <>
      {catchments.map(({ catchmentId, label }) => (
        <CatchmentRow
          key={catchmentId}
          catchmentId={catchmentId}
          label={label}
          columns={columns}
          quotaKgN={quotaByCatchment.get(catchmentId)}
        />
      ))}
    </>
  )
}
