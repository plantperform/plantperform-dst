import type { FieldRecord } from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { AppTooltip, TruncatedTooltip } from '@/components/ui/app-tooltip'
import { cropGroupFor } from '@/lib/crop-groups'
import { CURRENT_CALENDAR_YEAR } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

export const RotationYearRow = ({
  year,
  index,
  startYear,
}: {
  year: FieldRecord['cropRotation'][number]
  index: number
  startYear: number
}) => {
  const calendarYear = startYear + index
  const isCurrentYear = calendarYear === CURRENT_CALENDAR_YEAR
  return (
    <li className="flex items-center gap-x-2.5 px-1.5 py-1.5 @2xl:px-3">
      <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
        {calendarYear}
      </span>
      <CropGroupTile group={cropGroupFor(year.cropCode, year.cropName)} />
      <TruncatedTooltip
        content={year.cropName}
        className={cn('min-w-0 truncate', isCurrentYear && 'font-medium')}
      >
        {year.cropName}
      </TruncatedTooltip>
      {isCurrentYear ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
          i år
        </span>
      ) : null}
      {year.undersownCropName !== null ? (
        <AppTooltip content={year.undersownCropName}>
          <span className="ml-auto shrink-0 rounded-full border bg-muted px-2 py-0.5 text-xs text-primary">
            udlæg
          </span>
        </AppTooltip>
      ) : null}
    </li>
  )
}
