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
import { AppTooltip } from '@/components/ui/app-tooltip'
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
  const tile = (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
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
  return title ? <AppTooltip content={title}>{tile}</AppTooltip> : tile
}

type CropYearBlockProps = {
  group: CropGroupDefinition
  covers?: YearCover[]
  size?: TileSize
  title?: string
  className?: string
  tileClassName?: string
  showCoverTooltip?: boolean
}

export const CropYearBlock = ({
  group,
  covers,
  size = 'sm',
  title,
  className,
  tileClassName,
  showCoverTooltip,
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
        className={cn(covers.length > 0 && 'rounded-none', tileClassName)}
      />
      <WinterCoverBand
        covers={covers}
        className={size === 'sm' ? 'h-1' : 'h-2.5'}
        showTooltip={showCoverTooltip}
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
