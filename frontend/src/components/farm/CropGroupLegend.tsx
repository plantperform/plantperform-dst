import { useMemo } from 'react'

import type { FieldRecord } from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { WinterCoverLegend } from '@/components/farm/WinterCoverBand'
import { presentCropGroups } from '@/lib/crop-groups'
import { cn } from '@/lib/utils'
import { presentWinterCovers, rotationCovers } from '@/lib/winter-cover'

type CropGroupLegendProps = {
  fields: FieldRecord[]
  className?: string
}

export const CropGroupLegend = ({
  fields,
  className,
}: CropGroupLegendProps) => {
  const { groups, covers } = useMemo(() => {
    const years = fields.flatMap((field) => field.cropRotation)
    return {
      groups: presentCropGroups(years),
      covers: presentWinterCovers(rotationCovers(years) ?? []),
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
          <CropGroupTile group={group} />
          <span>{group.label}</span>
        </span>
      ))}
      {covers.length > 0 ? <WinterCoverLegend covers={covers} /> : null}
    </div>
  )
}
