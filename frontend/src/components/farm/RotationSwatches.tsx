import type { FieldRecord } from '@/api/types'
import { CropYearBlock } from '@/components/farm/CropGroupTile'
import { cropGroupFor } from '@/lib/crop-groups'
import { cn } from '@/lib/utils'
import { rotationCovers } from '@/lib/winter-cover'

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
}: RotationSwatchesProps) => {
  const yearCovers = rotationCovers(rotation)
  return (
    <span className="flex shrink-0 gap-0.5">
      {rotation.map((year, index) => {
        const calendarYear = startYear + index
        const covers = yearCovers?.[index] ?? []
        const title = `${calendarYear}: ${year.cropName}${
          year.undersownCropName !== null
            ? ` (udlæg: ${year.undersownCropName})`
            : ''
        }${covers.map((yearCover) => ` · ${yearCover.cover.label}`).join('')}`
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
            <CropYearBlock
              group={cropGroupFor(year.cropCode, year.cropName)}
              covers={yearCovers?.[index]}
              title={title}
              tileClassName={tileClassName}
            />
          </span>
        )
      })}
    </span>
  )
}
