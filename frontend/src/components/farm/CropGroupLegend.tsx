import { useMemo } from 'react'

import type { FieldRecord } from '@/api/types'
import { classifyCrop, CROP_GROUPS, type CropGroup } from '@/lib/crop-groups'
import { coverCropShadow } from '@/lib/field-domain'
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
    const present = new Set<CropGroup>()
    let anyUdlaeg = false
    for (const field of fields) {
      for (const year of field.cropRotation) {
        present.add(classifyCrop(year.afgrodeKode, year.afgrodeNavn))
        if (year.udlaegNavn !== null) anyUdlaeg = true
      }
    }
    return {
      groups: CROP_GROUPS.filter((group) => present.has(group.id)),
      hasUdlaeg: anyUdlaeg,
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
      <span>Afgrøder</span>
      {groups.map((group) => (
        <span key={group.id} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-3 shrink-0 rounded-xs outline-1 -outline-offset-1 outline-foreground/10"
            style={{ backgroundColor: group.color }}
          />
          <span>{group.label}</span>
        </span>
      ))}
      {hasUdlaeg ? (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="box-border h-2 w-3 shrink-0 rounded-xs bg-muted outline-1 -outline-offset-1 outline-foreground/10"
            style={{ boxShadow: coverCropShadow(true) }}
          />
          <span>med udlæg</span>
        </span>
      ) : null}
    </div>
  )
}
