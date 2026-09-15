import type { FieldRecord } from '@/api/types'
import {
  CropYearSwatch,
  type CropYearSwatchSize,
} from '@/components/farm/CropYearSwatch'
import { cropGroupColor, cropGroupPattern } from '@/lib/crop-groups'
import { cn } from '@/lib/utils'

type RotationSwatchesProps = {
  rotation: FieldRecord['cropRotation']
  startYear: number
  size: CropYearSwatchSize
  highlightIndex?: number | null
  swatchClassName?: string
}

export const RotationSwatches = ({
  rotation,
  startYear,
  size,
  highlightIndex = null,
  swatchClassName,
}: RotationSwatchesProps) => (
  <span className="flex shrink-0 gap-0.5">
    {rotation.map((year, index) => {
      const calendarYear = startYear + index
      const hasUndersownCrop = year.undersownCropName !== null
      const title = hasUndersownCrop
        ? `${calendarYear}: ${year.cropName} (udlæg: ${year.undersownCropName})`
        : `${calendarYear}: ${year.cropName}`
      const color = cropGroupColor(year.cropCode, year.cropName)
      const pattern = cropGroupPattern(year.cropCode, year.cropName)
      const isHighlighted = highlightIndex === index
      return (
        <span
          key={index}
          className={cn(
            'inline-flex rounded-xs motion-safe:transition-[opacity,box-shadow] motion-safe:duration-300',
            isHighlighted && 'ring-2 ring-primary ring-offset-1',
            highlightIndex !== null && !isHighlighted && 'opacity-60',
          )}
        >
          <CropYearSwatch
            title={title}
            color={color}
            pattern={pattern}
            hasUndersownCrop={hasUndersownCrop}
            size={size}
            className={swatchClassName}
          />
        </span>
      )
    })}
  </span>
)
