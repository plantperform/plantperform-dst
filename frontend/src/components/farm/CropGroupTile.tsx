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
  RoundStrawBale,
  SheafOfRice,
  WheatOutline,
} from '@/components/farm/crop-icons'
import { WinterCoverBand } from '@/components/farm/WinterCoverBand'
import { AppTooltip } from '@/components/ui/app-tooltip'
import {
  cropEdgeColor,
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
  wholeCropSilage: RoundStrawBale,
  grass: Grass,
  fallow: Daisy,
  other: OakLeaf,
}

type CropGroupIconProps = {
  group: CropGroupDefinition
  className?: string
}

export const CropGroupIcon = ({ group, className }: CropGroupIconProps) => {
  const Icon = ICONS[group.id]
  return <Icon className={className} />
}

type TileSize = 'sm' | 'md'

const TILE_CLASS: Record<TileSize | 'lg', string> = {
  sm: 'size-[18px] rounded-[3px]',
  md: 'h-6 rounded-[4px]',
  lg: 'size-[34px] rounded-[5px]',
}

const TILE_ICON_CLASS: Record<TileSize | 'lg', string> = {
  sm: 'size-3',
  md: 'size-4',
  lg: 'size-5',
}

type CropGroupTileProps = {
  group: CropGroupDefinition
  // Overrides the group colour, e.g. with a crop's shade of it.
  color?: string
  size?: TileSize | 'lg'
  title?: string
  className?: string
}

export const CropGroupTile = ({
  group,
  color = group.color,
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
        TILE_CLASS[size],
        className,
      )}
      style={{
        backgroundColor: color,
        color: readableTextColor(color),
        boxShadow: `inset 0 0 0 1px ${cropEdgeColor(color)}`,
      }}
    >
      <Icon className={TILE_ICON_CLASS[size]} />
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
