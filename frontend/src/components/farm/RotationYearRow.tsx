import type { FieldRecord } from '@/api/types'
import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
import { cropGroupColor, cropGroupPattern } from '@/lib/crop-groups'
import {
  CURRENT_CALENDAR_YEAR,
  QUOTA_STATUS_STYLES,
  type QuotaStatus,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

export const RotationYearRow = ({
  year,
  index,
  startYear,
  isSelected = false,
  selectedStatus,
  selectedValues = null,
}: {
  year: FieldRecord['cropRotation'][number]
  index: number
  startYear: number
  isSelected?: boolean
  selectedStatus?: QuotaStatus
  selectedValues?: string | null
}) => {
  const calendarYear = startYear + index
  const hasUndersownCrop = year.undersownCropName !== null
  const color = cropGroupColor(year.cropCode, year.cropName)
  const pattern = cropGroupPattern(year.cropCode, year.cropName)
  const isCurrentYear = calendarYear === CURRENT_CALENDAR_YEAR
  const style = selectedStatus
    ? QUOTA_STATUS_STYLES[selectedStatus.level]
    : undefined
  const showRightGroup = hasUndersownCrop || (isSelected && selectedValues !== null)
  return (
    <li
      className={cn(
        'motion-safe:transition-colors motion-safe:duration-300',
        isSelected && 'border-l-2 border-l-primary @2xl:border-l-4',
      )}
      aria-current={isSelected ? 'true' : undefined}
    >
      <div
        className={cn(
          'flex items-center gap-x-2.5 gap-y-1 px-1.5 py-1.5 motion-safe:transition-colors motion-safe:duration-300 @2xl:px-3',
          isSelected &&
            cn('flex-wrap rounded-r-md py-2 @2xl:py-2.5', style?.surface),
        )}
      >
        <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
          {calendarYear}
        </span>
        <CropYearSwatch
          color={color}
          pattern={pattern}
          hasUndersownCrop={hasUndersownCrop}
          size="14x10"
        />
        <span
          className={cn(
            'min-w-0 truncate',
            (isCurrentYear || isSelected) && 'font-medium',
          )}
          title={year.cropName}
        >
          {year.cropName}
        </span>
        {isSelected ? (
          <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-xs font-semibold text-primary-foreground">
            valgt år
          </span>
        ) : null}
        {isCurrentYear ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
            i år
          </span>
        ) : null}
        {showRightGroup ? (
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {hasUndersownCrop ? (
              <span className="rounded-full border bg-muted px-2 py-0.5 text-xs text-primary">
                efterafgrøde
              </span>
            ) : null}
            {isSelected && selectedValues !== null ? (
              <span
                className={cn(
                  'hidden rounded-md border bg-card px-3 py-1 text-xs tabular-nums @2xl:inline-block',
                  style?.text,
                )}
              >
                {selectedValues}
              </span>
            ) : null}
          </span>
        ) : null}
        {isSelected && selectedValues !== null ? (
          <span
            className={cn(
              'basis-full pl-11 text-xs tabular-nums @2xl:hidden',
              style?.text,
            )}
          >
            {selectedValues}
          </span>
        ) : null}
      </div>
    </li>
  )
}
