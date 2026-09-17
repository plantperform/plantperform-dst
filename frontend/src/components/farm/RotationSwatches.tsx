import type { FieldRecord } from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { cropGroupFor } from '@/lib/crop-groups'
import { cn } from '@/lib/utils'

type RotationSwatchesProps = {
  rotation: FieldRecord['cropRotation']
  startYear: number
  highlightIndex?: number | null
  tileClassName?: string
}

export const RotationSwatches = ({
  rotation,
  startYear,
  highlightIndex = null,
  tileClassName,
}: RotationSwatchesProps) => (
  <span className="flex shrink-0 gap-0.5">
    {rotation.map((year, index) => {
      const calendarYear = startYear + index
      const hasUndersownCrop = year.undersownCropName !== null
      const title = hasUndersownCrop
        ? `${calendarYear}: ${year.cropName} (udlæg: ${year.undersownCropName})`
        : `${calendarYear}: ${year.cropName}`
      const isHighlighted = highlightIndex === index
      return (
        <span
          key={index}
          className={cn(
            'inline-flex rounded-[3px] motion-safe:transition-[opacity,box-shadow] motion-safe:duration-300',
            isHighlighted && 'ring-2 ring-primary ring-offset-1',
            highlightIndex !== null && !isHighlighted && 'opacity-60',
          )}
        >
          <CropGroupTile
            group={cropGroupFor(year.cropCode, year.cropName)}
            hasUndersownCrop={hasUndersownCrop}
            title={title}
            className={tileClassName}
          />
        </span>
      )
    })}
  </span>
)
