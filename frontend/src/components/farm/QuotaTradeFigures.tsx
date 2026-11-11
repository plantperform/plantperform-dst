import type { SimulationQuotaTrade } from '@/api/types'
import { KeyFigure } from '@/components/farm/OverviewCard'
import type { FieldTotals } from '@/lib/field-domain'
import { quotaTradeContributionFigure } from '@/lib/quota-trade-result'

type Props = {
  trades: SimulationQuotaTrade[]
  // Use the same economics area as the card's main figure.
  totals: FieldTotals
}

export const QuotaTradeFigures = ({ trades, totals }: Props) => {
  if (trades.length === 0) return null
  return (
    <div className="border-t pt-3">
      <KeyFigure
        label="Kvotehandel pr. år"
        figure={quotaTradeContributionFigure(trades, totals.economicsAreaHa)}
      />
    </div>
  )
}
