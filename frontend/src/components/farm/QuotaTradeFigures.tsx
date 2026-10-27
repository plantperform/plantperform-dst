import type { SimulationQuotaTrade } from '@/api/types'
import { KeyFigure } from '@/components/farm/OverviewCard'
import {
  formatCompactDkk,
  perHaFigure,
  totalsPerHa,
  type FieldTotals,
} from '@/lib/field-domain'
import {
  describeQuotaPayment,
  describeQuotaTrade,
  quotaTradePayment,
} from '@/lib/quota-trade-result'

type Props = {
  trades: SimulationQuotaTrade[]
  // The crops' totals the card shows; the trades' payments come off their DB2.
  totals: FieldTotals
  catchmentLabel: (catchmentId: number) => string
}

export const QuotaTradeFigures = ({
  trades,
  totals,
  catchmentLabel,
}: Props) => {
  if (trades.length === 0) return null
  const db2 = totals.db2 - quotaTradePayment(trades)
  return (
    <div className="space-y-3 border-t pt-3">
      <KeyFigure
        label="Dækningsbidrag inkl. kvotehandel"
        figure={perHaFigure(
          totalsPerHa({ ...totals, db2 }, 'db2'),
          'db2',
          formatCompactDkk(db2),
        )}
      />
      <ul className="space-y-1.5" aria-label="Kvotehandel">
        {trades.map((trade) => {
          const label = trade.catchmentName ?? catchmentLabel(trade.catchmentId)
          return (
            <li
              key={trade.catchmentId}
              className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]"
            >
              <span className="max-w-[45%] truncate" title={label}>
                {label}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {describeQuotaTrade(trade)} ·{' '}
                {describeQuotaPayment(trade.paymentDkkPerYear)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
