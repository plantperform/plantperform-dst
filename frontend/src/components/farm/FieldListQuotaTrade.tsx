import type { Column } from '@tanstack/react-table'

import type { FieldRecord, SimulationQuotaTrade } from '@/api/types'
import { AppTooltip } from '@/components/ui/app-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'
import {
  formatNumber,
  formatWholeNumber,
  perHaFigure,
  totalsPerHa,
  type FieldTotals,
} from '@/lib/field-domain'
import {
  db2IncludingQuotaTrades,
  describeQuotaTrade,
  describeTradeKg,
  quotaTradeContributionFigure,
  quotaTradeKgIn,
  tradePriceDkkPerKg,
} from '@/lib/quota-trade-result'
import { cn } from '@/lib/utils'

type TradeRowProps = {
  trade: SimulationQuotaTrade
  totals: FieldTotals
  calendarYear: number | null
  catchmentLabel: string
  columns: Column<FieldRecord, unknown>[]
  selected: boolean
  dimmed: boolean
  height: number
  loading: boolean
  sizing?: boolean
}

export const FieldListQuotaTradeRow = ({
  trade,
  totals,
  calendarYear,
  catchmentLabel,
  columns,
  selected,
  dimmed,
  height,
  loading,
  sizing = false,
}: TradeRowProps) => {
  const figure = quotaTradeContributionFigure(
    [trade],
    loading ? 0 : totals.economicsAreaHa,
    calendarYear,
  )
  const kg = quotaTradeKgIn(trade, calendarYear)
  const description =
    calendarYear === null
      ? `Gennemsnit pr. år: ${describeQuotaTrade(trade)}`
      : `${calendarYear}: ${describeTradeKg(kg, false)} · ${formatNumber(tradePriceDkkPerKg(trade, kg))} kr/kg N`
  const basis = loading
    ? 'Årets marktal hentes.'
    : totals.economicsAreaHa > 0
      ? `Pr. ha er fordelt på oplandets ${formatNumber(totals.economicsAreaHa)} ha med økonomiberegning.`
      : 'Ingen beregnet økonomiareal; beløbet vises kun i kr.'
  const tooltip = `${catchmentLabel}. ${description}. ${basis}`

  return (
    <TableRow
      aria-label={sizing ? undefined : `Kvotehandel for ${catchmentLabel}`}
      aria-hidden={sizing || undefined}
      style={{ height: sizing ? 0 : height }}
      className={cn(
        'bg-muted/20',
        selected && 'bg-primary/5',
        dimmed && 'opacity-50',
        sizing && 'border-0',
      )}
    >
      {columns.map((column) => {
        const content =
          column.id === 'name' ? (
            <span className="font-medium">Kvotehandel</span>
          ) : column.id === 'db2' ? (
            <div>
              <div className="font-medium">{figure.value}</div>
              {figure.total ? (
                <div className="text-xs font-normal text-muted-foreground">
                  {figure.total}
                </div>
              ) : null}
            </div>
          ) : null
        return (
          <TableCell
            key={column.id}
            className={cn(
              column.columnDef.meta?.cellClassName,
              sizing && 'py-0 full:py-0',
            )}
          >
            {sizing ? (
              <div className="h-0 overflow-hidden">{content}</div>
            ) : content ? (
              <AppTooltip content={tooltip}>{content}</AppTooltip>
            ) : null}
          </TableCell>
        )
      })}
    </TableRow>
  )
}

type Db2FooterProps = {
  totals: FieldTotals
  trades: SimulationQuotaTrade[]
  calendarYear: number | null
  loading: boolean
}

export const FieldListDb2Footer = ({
  totals,
  trades,
  calendarYear,
  loading,
}: Db2FooterProps) => {
  if (loading) {
    return (
      <span role="status" aria-label="Henter årets DB2">
        <Skeleton className="ml-auto h-8 w-24" />
      </span>
    )
  }
  const db2 = db2IncludingQuotaTrades(totals.db2, trades, calendarYear)
  const figure = perHaFigure(
    totalsPerHa({ ...totals, db2 }, 'db2'),
    'db2',
    `${formatWholeNumber(db2)} kr`,
  )
  return (
    <AppTooltip content={trades.length > 0 ? 'DB2 inkl. kvotehandel' : null}>
      <div>
        <div className="font-medium">{figure.value}</div>
        {figure.total ? (
          <div className="text-xs font-normal text-muted-foreground">
            {figure.total}
          </div>
        ) : null}
      </div>
    </AppTooltip>
  )
}
