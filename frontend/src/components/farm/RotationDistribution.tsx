import { useState } from 'react'

import { ShareDonut } from '@/components/farm/ShareDonut'
import { AppTooltip } from '@/components/ui/app-tooltip'
import {
  formatFieldCount,
  formatHectares,
  formatShare,
  formatWholeNumber,
} from '@/lib/field-domain'
import {
  NO_ROTATION_COLOR,
  cropSequenceText,
  PERMANENT_ROTATION,
  rotationColorsOf,
  rotationKey,
  rotationLabel,
  type RotationShare,
} from '@/lib/rotation-overview'
import { cn } from '@/lib/utils'

const formatArea = (areaHa: number) =>
  areaHa > 0 && areaHa < 0.1 ? '< 0,1' : formatHectares(areaHa)

const shareKey = (entry: RotationShare) => rotationKey(entry.rotationVariant)

const shareLabel = (entry: RotationShare) =>
  rotationLabel(entry.rotationVariant)

// The donut hole only has room for a short name.
const shortShareLabel = (entry: RotationShare) =>
  entry.rotationVariant === PERMANENT_ROTATION
    ? 'Permanente'
    : shareLabel(entry)

const shareTooltip = (entry: RotationShare) => (
  <span className="flex flex-col gap-0.5">
    <span className="font-medium">{shareLabel(entry)}</span>
    {entry.cropSequence ? (
      <span>{cropSequenceText(entry.cropSequence)}</span>
    ) : null}
    <span>{formatFieldCount(entry.fieldCount)}</span>
  </span>
)

type RotationDistributionProps = {
  shares: RotationShare[]
  // The colour of each rotation (see rotationColorsOf). Hand it the colours of
  // the whole farm to keep them as on the map when the shares are of one opland.
  colors?: Map<string, string>
}

export const RotationDistribution = ({
  shares,
  colors: farmColors,
}: RotationDistributionProps) => {
  const [hovered, setHovered] = useState<string | null>(null)
  const totalHa = shares.reduce((sum, entry) => sum + entry.areaHa, 0)
  const active = shares.find((entry) => shareKey(entry) === hovered)
  const colors = farmColors ?? rotationColorsOf(shares)
  const colorOf = (entry: RotationShare) =>
    colors.get(shareKey(entry)) ?? NO_ROTATION_COLOR
  return (
    <div className="flex flex-col items-center gap-3 @lg:flex-row @lg:gap-3 @xl:gap-5">
      <ShareDonut
        className="size-28 shrink-0 @lg:sticky @lg:top-0 @lg:self-start @xl:size-36"
        slices={shares
          .filter((entry) => entry.share > 0)
          .map((entry) => ({
            id: shareKey(entry),
            share: entry.share,
            color: colorOf(entry),
            tooltip: shareTooltip(entry),
          }))}
        hovered={hovered}
        onHover={setHovered}
        onLeave={() => setHovered(null)}
        value={
          active
            ? formatShare(active.share)
            : `${formatWholeNumber(totalHa)} ha`
        }
        label={active ? shortShareLabel(active) : 'i alt'}
      />
      <ul
        aria-label="Sædskifter"
        className="flex w-full min-w-0 flex-col @lg:w-auto @lg:flex-1"
      >
        {shares.map((entry) => {
          const withoutRotation = entry.rotationVariant === null
          const color = colorOf(entry)
          return (
            <AppTooltip key={shareKey(entry)} content={shareTooltip(entry)}>
              <li
                className={cn(
                  'flex flex-col gap-1 border-b border-border/60 px-1 py-1.5 text-[13px] leading-5 last:border-b-0',
                  hovered === shareKey(entry) && 'bg-muted',
                )}
                onMouseEnter={() => setHovered(shareKey(entry))}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 self-center rounded-[3px]"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className={cn(
                        'min-w-0 font-medium',
                        withoutRotation && 'text-muted-foreground',
                      )}
                    >
                      {shareLabel(entry)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-semibold">
                      {formatArea(entry.areaHa)}
                    </span>{' '}
                    ha
                    <span className="ml-2 inline-block w-12 text-right text-muted-foreground">
                      {formatShare(entry.share)}
                    </span>
                  </span>
                </div>
                {entry.cropSequence ? (
                  <p className="text-[11px] leading-4 text-pretty text-muted-foreground">
                    {entry.cropSequence.join(' → ')}
                  </p>
                ) : null}
              </li>
            </AppTooltip>
          )
        })}
      </ul>
    </div>
  )
}
