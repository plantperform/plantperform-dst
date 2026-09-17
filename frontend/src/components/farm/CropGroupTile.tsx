import type { ComponentType } from 'react'

import {
  Beet,
  Daisy,
  EarOfCorn,
  Flax,
  Grass,
  HighGrass,
  OakLeaf,
  PeaPod,
  Potato,
  SheafOfRice,
  WheatOutline,
} from '@/components/farm/crop-icons'
import {
  readableTextColor,
  type CropGroup,
  type CropGroupDefinition,
} from '@/lib/crop-groups'
import { coverCropShadow } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const ICONS: Record<CropGroup, ComponentType<{ className?: string }>> = {
  springCereal: WheatOutline,
  winterCereal: SheafOfRice,
  maize: EarOfCorn,
  oilseed: Flax,
  legume: PeaPod,
  potato: Potato,
  beet: Beet,
  seedGrass: HighGrass,
  grass: Grass,
  fallow: Daisy,
  other: OakLeaf,
}

type CropGroupTileProps = {
  group: CropGroupDefinition
  hasUndersownCrop: boolean
  size?: 'sm' | 'md'
  title?: string
  className?: string
}

export const CropGroupTile = ({
  group,
  hasUndersownCrop,
  size = 'sm',
  title,
  className,
}: CropGroupTileProps) => {
  const Icon = ICONS[group.id]
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : 'true'}
      className={cn(
        'flex shrink-0 items-center justify-center',
        size === 'sm' ? 'size-[18px] rounded-[3px]' : 'h-6 rounded-[4px]',
        hasUndersownCrop && 'pb-1',
        className,
      )}
      style={{
        backgroundColor: group.color,
        color: readableTextColor(group.color),
        boxShadow: coverCropShadow(hasUndersownCrop),
      }}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-4'} />
    </span>
  )
}

export const CoverCropSwatch = () => (
  <span
    aria-hidden="true"
    className="box-border h-3 w-4 shrink-0 rounded-xs bg-muted outline-1 -outline-offset-1 outline-foreground/10"
    style={{ boxShadow: coverCropShadow(true) }}
  />
)
