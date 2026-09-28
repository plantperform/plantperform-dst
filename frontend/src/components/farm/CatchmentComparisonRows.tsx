import { useId, useState } from 'react'

import { CatchmentYearBars } from '@/components/farm/CatchmentYearBars'
import { CatchmentYearTable } from '@/components/farm/CatchmentYearTable'
import {
  ComparisonCell,
  ComparisonRowHeader,
  ComparisonValue,
} from '@/components/farm/ComparisonTableParts'
import { CatchmentYearStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import { LoadError } from '@/components/ui/load-error'
import { TableCell, TableRow } from '@/components/ui/table'
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
  title: string
  catchments: CatchmentTotalsByYear | undefined
  partialQuotas: ReadonlyMap<number, number>
  retrying: boolean
  onRetry: () => void
}

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
  open: boolean
  onToggle: () => void
  quotaKgN: number | undefined
}

const CatchmentRow = ({
  catchmentId,
  label,
  columns,
  open,
  onToggle,
  quotaKgN,
}: CatchmentRowProps) => {
  const detailId = useId()
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
    <>
      <TableRow className="hover:bg-transparent has-aria-expanded:bg-transparent">
        <ComparisonRowHeader
          note={quotaKgN === undefined ? null : `Kvote ${formatKgN(quotaKgN)}`}
        >
          <DisclosureButton
            open={open}
            onToggle={onToggle}
            label={label}
            aria-controls={detailId}
          />
        </ComparisonRowHeader>
        {columns.map((column, index) => {
          const comparison = comparisons[index]
          return (
            <ComparisonCell key={column.key}>
              {comparison === undefined ? null : comparison === null ? (
                <span className="text-sm text-muted-foreground">
                  {QUOTA_STATUS_LABELS.noData}
                </span>
              ) : (
                <CatchmentFigures
                  comparison={comparison}
                  best={index === best}
                />
              )}
            </ComparisonCell>
          )
        })}
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell
            colSpan={columns.length + 1}
            className="p-0 whitespace-normal"
          >
            <CatchmentYearTable
              id={detailId}
              columns={columns.map((column, index) => ({
                key: column.key,
                title: column.title,
                years: comparisons[index]?.years ?? null,
              }))}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </>
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
  const [openCatchmentId, setOpenCatchmentId] = useState<number | null>(null)
  const catchments = listComparedCatchments(columns, catchmentLabel)
  const failed = columns.some((column) => column.catchments === undefined)
  return (
    <>
      {failed ? (
        <TableRow className="hover:bg-transparent">
          <ComparisonRowHeader>Kystvandoplande</ComparisonRowHeader>
          {columns.map((column) => (
            <ComparisonCell key={column.key}>
              {column.catchments === undefined ? (
                <LoadError
                  message="Kunne ikke hente tallene."
                  onRetry={column.onRetry}
                  retrying={column.retrying}
                />
              ) : null}
            </ComparisonCell>
          ))}
        </TableRow>
      ) : null}
      {catchments.map(({ catchmentId, label }) => (
        <CatchmentRow
          key={catchmentId}
          catchmentId={catchmentId}
          label={label}
          columns={columns}
          open={openCatchmentId === catchmentId}
          onToggle={() =>
            setOpenCatchmentId((current) =>
              current === catchmentId ? null : catchmentId,
            )
          }
          quotaKgN={quotaByCatchment.get(catchmentId)}
        />
      ))}
    </>
  )
}
