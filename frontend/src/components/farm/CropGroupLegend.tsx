import { useMemo } from 'react'

import type { FieldRecord } from '@/api/types'
import { CoverCropSwatch, CropGroupTile } from '@/components/farm/CropGroupTile'
import { presentCropGroups } from '@/lib/crop-groups'
import { cn } from '@/lib/utils'

type CropGroupLegendProps = {
  fields: FieldRecord[]
  className?: string
}

export const CropGroupLegend = ({
  fields,
  className,
}: CropGroupLegendProps) => {
  const { groups, hasUndersownCrop } = useMemo(() => {
    const years = fields.flatMap((field) => field.cropRotation)
    return {
      groups: presentCropGroups(years),
      hasUndersownCrop: years.some((year) => year.undersownCropName !== null),
    }
  }, [fields])

  if (groups.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <span className="font-medium text-foreground">Afgrøder</span>
      {groups.map((group) => (
        <span key={group.id} className="inline-flex items-center gap-1.5">
          <CropGroupTile group={group} hasUndersownCrop={false} />
          <span>{group.label}</span>
        </span>
      ))}
      {hasUndersownCrop ? (
        <span className="inline-flex items-center gap-1.5">
          <CoverCropSwatch />
          <span>med udlæg</span>
        </span>
      ) : null}
    </div>
  )
}
