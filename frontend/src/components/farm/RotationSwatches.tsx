import type { FieldRecord } from '@/api/types'
import {
  CropYearSwatch,
  type CropYearSwatchSize,
} from '@/components/farm/CropYearSwatch'
import { cropGroupColor } from '@/lib/crop-groups'
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
      const hasUdlaeg = year.udlaegNavn !== null
      const title = hasUdlaeg
        ? `${calendarYear}: ${year.afgrodeNavn} (udlæg: ${year.udlaegNavn})`
        : `${calendarYear}: ${year.afgrodeNavn}`
      const color = cropGroupColor(year.afgrodeKode, year.afgrodeNavn)
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
            hasUdlaeg={hasUdlaeg}
            size={size}
            className={swatchClassName}
          />
        </span>
      )
    })}
  </span>
)
