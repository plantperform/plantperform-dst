import {
  Leaf,
  Shovel,
  Snowflake,
  Sprout,
  Sunrise,
  WheatOff,
  type LucideIcon,
} from 'lucide-react'

import { AppTooltip } from '@/components/ui/app-tooltip'
import { readableTextColor } from '@/lib/crop-groups'
import { cn } from '@/lib/utils'
import type {
  WinterCoverDefinition,
  WinterCoverKind,
  YearCover,
} from '@/lib/winter-cover'

const ICONS: Record<WinterCoverKind, LucideIcon> = {
  catchCrop: Sprout,
  intermediateCrop: Leaf,
  cropCover: Snowflake,
  stubble: WheatOff,
  bareSoil: Shovel,
  earlySowing: Sunrise,
}

type WinterCoverBandProps = {
  covers: YearCover[]
  className?: string
  showTooltip?: boolean
}

export const WinterCoverBand = ({
  covers,
  className,
  showTooltip = true,
}: WinterCoverBandProps) => (
  <span className={cn('flex gap-px', className)}>
    {covers.map((yearCover) => (
      <AppTooltip
        key={yearCover.cover.id}
        content={showTooltip ? `${yearCover.cover.label}. ${yearCover.description}` : null}
      >
        <span
          className="flex-1"
          style={{ backgroundColor: yearCover.cover.color }}
        />
      </AppTooltip>
    ))}
  </span>
)

type WinterCoverSwatchProps = {
  cover: WinterCoverDefinition
  className?: string
}

export const WinterCoverSwatch = ({
  cover,
  className,
}: WinterCoverSwatchProps) => {
  const Icon = ICONS[cover.id]
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-[18px] shrink-0 items-center justify-center rounded-[3px]',
        className,
      )}
      style={{
        backgroundColor: cover.color,
        color: readableTextColor(cover.color),
      }}
    >
      <Icon className="size-3" />
    </span>
  )
}

type WinterCoverLegendProps = {
  covers: WinterCoverDefinition[]
  className?: string
}

export const WinterCoverLegend = ({
  covers,
  className,
}: WinterCoverLegendProps) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground',
      className,
    )}
  >
    <span className="font-medium text-foreground">Efter høst</span>
    {covers.map((cover) => (
      <span key={cover.id} className="inline-flex items-center gap-1.5">
        <WinterCoverSwatch cover={cover} />
        <span>{cover.label}</span>
      </span>
    ))}
  </div>
)
