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
import { WinterCoverBand } from '@/components/farm/WinterCoverBand'
import {
  readableTextColor,
  type CropGroup,
  type CropGroupDefinition,
} from '@/lib/crop-groups'
import { cn } from '@/lib/utils'
import type { YearCover } from '@/lib/winter-cover'

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

type TileSize = 'sm' | 'md'

type CropGroupTileProps = {
  group: CropGroupDefinition
  size?: TileSize
  title?: string
  className?: string
}

export const CropGroupTile = ({
  group,
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
        className,
      )}
      style={{
        backgroundColor: group.color,
        color: readableTextColor(group.color),
      }}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-4'} />
    </span>
  )
}

type CropYearBlockProps = {
  group: CropGroupDefinition
  covers?: YearCover[]
  size?: TileSize
  title?: string
  className?: string
  tileClassName?: string
}

export const CropYearBlock = ({
  group,
  covers,
  size = 'sm',
  title,
  className,
  tileClassName,
}: CropYearBlockProps) =>
  covers ? (
    <span
      className={cn(
        'flex flex-col gap-px overflow-hidden',
        size === 'sm' ? 'rounded-[3px]' : 'rounded-[4px]',
        className,
      )}
    >
      <CropGroupTile
        group={group}
        size={size}
        title={title}
        className={cn('rounded-none', tileClassName)}
      />
      <WinterCoverBand
        covers={covers}
        className={size === 'sm' ? 'h-1' : 'h-2.5'}
      />
    </span>
  ) : (
    <CropGroupTile
      group={group}
      size={size}
      title={title}
      className={cn(className, tileClassName)}
    />
  )
