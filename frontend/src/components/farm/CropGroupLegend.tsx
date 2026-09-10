import { useMemo } from 'react'

import type { FieldRecord } from '@/api/types'
import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
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
  const { groups, hasUdlaeg } = useMemo(() => {
    const years = fields.flatMap((field) => field.cropRotation)
    return {
      groups: presentCropGroups(years),
      hasUdlaeg: years.some((year) => year.udlaegNavn !== null),
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
          <CropYearSwatch color={group.color} hasUdlaeg={false} size="8x12" />
          <span>{group.label}</span>
        </span>
      ))}
      {hasUdlaeg ? (
        <span className="inline-flex items-center gap-1.5">
          <CropYearSwatch color="var(--color-muted)" hasUdlaeg size="8x12" />
          <span>med udlæg</span>
        </span>
      ) : null}
    </div>
  )
}
