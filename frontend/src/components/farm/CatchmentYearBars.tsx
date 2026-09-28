import { AppTooltip } from '@/components/ui/app-tooltip'
import { formatWholeNumber, QUOTA_STATUS_STYLES } from '@/lib/field-domain'
import {
  quotaBarShare,
  type CatchmentYearQuota,
} from '@/lib/simulation-comparison'
import { cn } from '@/lib/utils'

type CatchmentYearBarsProps = {
  years: CatchmentYearQuota[]
}

export const CatchmentYearBars = ({ years }: CatchmentYearBarsProps) => (
  <div aria-hidden="true" className="w-40">
    <div className="relative flex h-10 items-end gap-1">
      <div
        className="absolute inset-x-0 border-t-[1.5px] border-dashed border-foreground/45"
        style={{ bottom: `${quotaBarShare(100)}%` }}
      />
      {years.map(({ year, quotaPct, level }) => (
        <AppTooltip
          key={year}
          content={
            quotaPct === null
              ? `${year}: ingen tal`
              : `${year}: ${formatWholeNumber(quotaPct)} % af kvoten`
          }
        >
          <div
            className={cn(
              'flex-1 rounded-t-[3px]',
              level === 'over'
                ? QUOTA_STATUS_STYLES.over.dot
                : 'bg-muted-foreground/40',
            )}
            style={{ height: `${quotaBarShare(quotaPct ?? 0)}%` }}
          />
        </AppTooltip>
      ))}
    </div>
    <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
      <span>{years[0]?.year}</span>
      <span>{years[years.length - 1]?.year}</span>
    </div>
  </div>
)
