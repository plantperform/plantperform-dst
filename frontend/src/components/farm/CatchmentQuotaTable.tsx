import { ChevronRight } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { CatchmentYearCurves } from '@/components/farm/CatchmentYearCurves'
import {
  BEST_TEXT_CLASS,
  columnCellClass,
  columnFigure,
  completeFigure,
  HIGHLIGHT_HEAD_CLASS,
  highlightHandlers,
  HISTORY_HEAD_CLASS,
  TABLE_HEAD_CLASS,
  type ComparedColumn,
  type OnHighlight,
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
import {
  formatSigned,
  formatWholeNumber,
  QUOTA_STATUS_STYLES,
} from '@/lib/field-domain'
import {
  bestColumnIndex,
  describeCatchmentYearsOver,
  formatFeedUnits,
  formatKgN,
  formatYears,
  summarizeCatchmentComparison,
  type ComparedCatchment,
  type FeedUnitRequirementPlacement,
} from '@/lib/simulation-comparison'
import type { CatchmentYearStatus } from '@/lib/simulation-overview'
import { cn } from '@/lib/utils'

const LABEL_CELL_CLASS =
  'h-auto px-4.5 align-top font-normal whitespace-normal text-foreground'

const cellClass = (column: ComparedColumn, highlightedKey: string | null) =>
  cn(
    'border-l border-border/60 px-4 align-top whitespace-normal transition-colors duration-120',
    columnCellClass(column, highlightedKey),
  )

const statusClass = (status: CatchmentYearStatus) =>
  status.level === 'over'
    ? QUOTA_STATUS_STYLES.over.text
    : status.level === 'ok' || status.level === 'near'
      ? BEST_TEXT_CLASS
      : 'text-muted-foreground'

type CatchmentRowProps = {
  catchment: ComparedCatchment
  columns: ComparedColumn[]
  quotaKgN: number | undefined
  open: boolean
  onToggle: () => void
  highlightedKey: string | null
  onHighlight: OnHighlight
  hoveredYear: number | null
  onHoverYear: (index: number | null) => void
  bestKey: string | null
  overlay: boolean
  onToggleOverlay: () => void
}

const CatchmentRow = ({
  catchment,
  columns,
  quotaKgN,
  open,
  onToggle,
  highlightedKey,
  onHighlight,
  hoveredYear,
  onHoverYear,
  bestKey,
  overlay,
  onToggleOverlay,
}: CatchmentRowProps) => {
  const detailId = useId()
  const comparisons = columns.map((column) =>
    column.catchments === undefined
      ? undefined
      : summarizeCatchmentComparison(
          catchment.catchmentId,
          column.catchments,
          column.partialQuotas.get(catchment.catchmentId),
        ),
  )
  return (
    <>
      <TableRow
        className="cursor-pointer border-border hover:bg-transparent has-aria-expanded:bg-transparent"
        onClick={onToggle}
      >
        <TableHead scope="row" className={cn(LABEL_CELL_CLASS, 'py-3.5')}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
            className="flex items-start gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
                open && 'rotate-90',
              )}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                {catchment.label}
              </span>
              {quotaKgN === undefined ? null : (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Kvote {formatKgN(quotaKgN)} pr. år
                </span>
              )}
            </span>
          </button>
        </TableHead>
        {columns.map((column, index) => {
          const comparison = comparisons[index]
          return (
            <TableCell
              key={column.key}
              className={cn(cellClass(column, highlightedKey), 'py-3')}
              {...highlightHandlers(column.key, onHighlight)}
            >
              {comparison === undefined ? (
                <div onClick={(event) => event.stopPropagation()}>
                  <LoadError
                    message="Kunne ikke hente tallene."
                    onRetry={column.onRetry}
                    retrying={column.retrying}
                  />
                </div>
              ) : comparison === null ? (
                <span className="text-sm text-muted-foreground">
                  Ingen kvote
                </span>
              ) : (
                <>
                  <span className="block font-display text-2xl leading-tight tabular-nums">
                    {formatYears(comparison.status.overYears.length)}
                  </span>
                  <span
                    className={cn(
                      'mt-1 block text-xs font-semibold',
                      statusClass(comparison.status),
                    )}
                  >
                    {describeCatchmentYearsOver(comparison.status)}
                  </span>
                </>
              )}
            </TableCell>
          )
        })}
      </TableRow>
      {open ? (
        <TableRow className="border-border hover:bg-transparent">
          <TableCell colSpan={columns.length + 1} className="p-0">
            <CatchmentYearCurves
              id={detailId}
              hoveredYear={hoveredYear}
              onHoverYear={onHoverYear}
              highlightedKey={highlightedKey}
              onHighlight={onHighlight}
              bestKey={bestKey}
              overlay={overlay}
              onToggleOverlay={onToggleOverlay}
              rows={columns.map((column, index) => ({
                key: column.key,
                title: column.title,
                history: column.history,
                years: comparisons[index]?.years ?? null,
                averagePct: comparisons[index]?.average?.quotaPct ?? null,
                status: comparisons[index]?.status ?? null,
              }))}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

type FigureRowProps = {
  label: ReactNode
  note?: string | null
  columns: ComparedColumn[]
  highlightedKey: string | null
  onHighlight: OnHighlight
  children: (column: ComparedColumn, index: number) => ReactNode
}

const FigureRow = ({
  label,
  note,
  columns,
  highlightedKey,
  onHighlight,
  children,
}: FigureRowProps) => (
  <TableRow className="border-border/60 hover:bg-transparent">
    <TableHead scope="row" className={cn(LABEL_CELL_CLASS, 'py-3 text-[13px]')}>
      {label}
      {note ? (
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {note}
        </span>
      ) : null}
    </TableHead>
    {columns.map((column, index) => (
      <TableCell
        key={column.key}
        className={cn(cellClass(column, highlightedKey), 'py-2.5')}
        {...highlightHandlers(column.key, onHighlight)}
      >
        {children(column, index)}
      </TableCell>
    ))}
  </TableRow>
)

const toggled = (ids: ReadonlySet<number>, id: number): ReadonlySet<number> => {
  const next = new Set(ids)
  if (!next.delete(id)) next.add(id)
  return next
}

type CatchmentQuotaTableProps = {
  columns: ComparedColumn[]
  catchments: ComparedCatchment[]
  quotaByCatchment: ReadonlyMap<number, number>
  showFeedUnits: boolean
  feedUnitRequirements: FeedUnitRequirementPlacement
  highlightedKey: string | null
  onHighlight: OnHighlight
  bestBalanceKey: string | null
}

export const CatchmentQuotaTable = ({
  columns,
  catchments,
  quotaByCatchment,
  showFeedUnits,
  feedUnitRequirements,
  highlightedKey,
  onHighlight,
  bestBalanceKey,
}: CatchmentQuotaTableProps) => {
  const [hoveredYear, setHoveredYear] = useState<number | null>(null)
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(
    () => new Set(catchments.slice(0, 1).map(({ catchmentId }) => catchmentId)),
  )
  const [overlayIds, setOverlayIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  )
  const feedUnits = columns.map((column) =>
    columnFigure(column, column.totals.feedUnits),
  )
  const bestFeedUnits = bestColumnIndex(
    columns.map((column, index) => completeFigure(column, feedUnits[index])),
    'highest',
    formatFeedUnits,
  )
  const historyFeedUnits = feedUnits[0]
  return (
    <Table
      containerClassName="rounded-lg border bg-card"
      className="table-fixed"
    >
      <colgroup>
        <col className="w-56" />
        {columns.map((column) => (
          <col key={column.key} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead
            className={cn(
              'h-auto px-4.5 py-2.5 align-bottom text-xs font-normal text-muted-foreground',
              TABLE_HEAD_CLASS,
            )}
          >
            <span className="inline-flex items-center gap-1">
              Opland
              <GlossaryInfo term="catchment" />
            </span>
          </TableHead>
          {columns.map((column) => (
            <TableHead
              key={column.key}
              scope="col"
              className={cn(
                'h-auto border-l border-border/60 px-4 py-2.5 align-top font-normal whitespace-normal transition-colors duration-120',
                column.history
                  ? HISTORY_HEAD_CLASS
                  : column.key === highlightedKey
                    ? HIGHLIGHT_HEAD_CLASS
                    : TABLE_HEAD_CLASS,
              )}
              {...highlightHandlers(column.key, onHighlight)}
            >
              <span className="block font-display text-[17px] leading-tight">
                {column.title}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {column.history ? 'Udgangspunkt' : column.subtitle}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {catchments.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={columns.length + 1}
              className="px-4.5 py-4 text-sm text-muted-foreground"
            >
              Ingen af markerne ligger i et opland med kvote.
            </TableCell>
          </TableRow>
        ) : null}
        {catchments.map((catchment) => (
          <CatchmentRow
            key={catchment.catchmentId}
            catchment={catchment}
            columns={columns}
            quotaKgN={quotaByCatchment.get(catchment.catchmentId)}
            open={openIds.has(catchment.catchmentId)}
            onToggle={() =>
              setOpenIds((ids) => toggled(ids, catchment.catchmentId))
            }
            highlightedKey={highlightedKey}
            onHighlight={onHighlight}
            hoveredYear={hoveredYear}
            onHoverYear={setHoveredYear}
            bestKey={bestBalanceKey}
            overlay={overlayIds.has(catchment.catchmentId)}
            onToggleOverlay={() =>
              setOverlayIds((ids) => toggled(ids, catchment.catchmentId))
            }
          />
        ))}
        {showFeedUnits ? (
          <FigureRow
            label={
              <span className="inline-flex items-center gap-1">
                Foderenheder pr. år
                <GlossaryInfo term="feedUnits" />
              </span>
            }
            note={feedUnitRequirements.label}
            columns={columns}
            highlightedKey={highlightedKey}
            onHighlight={onHighlight}
          >
            {(column, index) => {
              const value = feedUnits[index]
              const best = index === bestFeedUnits
              const note = feedUnitRequirements.cells[index]
              return value === null ? (
                <span className="text-sm text-muted-foreground">Ingen tal</span>
              ) : (
                <>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={cn(
                        'font-display text-xl leading-tight tabular-nums',
                        best && BEST_TEXT_CLASS,
                      )}
                    >
                      {formatFeedUnits(value)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {column.history || historyFeedUnits === null
                        ? null
                        : `${formatSigned(Math.round(value - historyFeedUnits), formatWholeNumber)} FE`}
                      {best ? (
                        <>
                          {column.history || historyFeedUnits === null
                            ? null
                            : ' · '}
                          <span
                            className={cn('font-semibold', BEST_TEXT_CLASS)}
                          >
                            højest
                          </span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {note ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {note}
                    </span>
                  ) : null}
                </>
              )
            }}
          </FigureRow>
        ) : null}
        <FigureRow
          label="Marker ændret"
          note="i forhold til afgrødehistorikken"
          columns={columns}
          highlightedKey={highlightedKey}
          onHighlight={onHighlight}
        >
          {(column) =>
            column.changedCount === null ? (
              <span className="font-display text-xl text-muted-foreground">
                -
              </span>
            ) : (
              <span className="font-display text-xl leading-tight tabular-nums">
                {column.changedCount} af {column.fields.length}
              </span>
            )
          }
        </FigureRow>
      </TableBody>
    </Table>
  )
}
