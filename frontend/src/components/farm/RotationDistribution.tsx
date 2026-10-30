import { useState } from 'react'

import { AppTooltip } from '@/components/ui/app-tooltip'
import { BRAND_COLORS } from '@/lib/brand-colors'
import {
  formatFieldCount,
  formatHectares,
  formatShare,
  formatWholeNumber,
} from '@/lib/field-domain'
import type { RotationShare } from '@/lib/rotation-overview'
import { cn } from '@/lib/utils'

const DONUT_RADIUS = 40
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS
const DONUT_GAP = 0.8
const DONUT_WIDTH = 16

const ROTATION_COLORS = [
  BRAND_COLORS.water,
  BRAND_COLORS.forest,
  BRAND_COLORS.carrot,
  BRAND_COLORS.berry,
  BRAND_COLORS.waterTertiary,
  BRAND_COLORS.soil,
  BRAND_COLORS.forestTertiary,
  BRAND_COLORS.sun,
  BRAND_COLORS.redBrown,
  BRAND_COLORS.freshGreen,
]
const NO_ROTATION_COLOR = '#B8B2A7'

const formatArea = (areaHa: number) =>
  areaHa > 0 && areaHa < 0.1 ? '< 0,1' : formatHectares(areaHa)

const shareKey = (entry: RotationShare) => entry.rotationVariant ?? 'none'

// The backend uses "permanent" as the rotation number of permanent crops.
const PERMANENT_ROTATION = 'permanent'

const shareLabel = (entry: RotationShare) =>
  entry.rotationVariant === null
    ? 'Uden sædskifte'
    : entry.rotationVariant === PERMANENT_ROTATION
      ? 'Permanente sædskifter'
      : `Sædskifte ${entry.rotationVariant}`

// The donut hole only has room for a short name.
const shortShareLabel = (entry: RotationShare) =>
  entry.rotationVariant === PERMANENT_ROTATION
    ? 'Permanente'
    : shareLabel(entry)

const shareTooltip = (entry: RotationShare) => (
  <span className="flex flex-col gap-0.5">
    <span className="font-medium">{shareLabel(entry)}</span>
    {entry.cropSequence ? (
      <span>
        {entry.cropSequence
          .map((crop, index) => `${index + 1}. ${crop}`)
          .join(' → ')}
      </span>
    ) : null}
    <span>{formatFieldCount(entry.fieldCount)}</span>
  </span>
)

type RotationDistributionProps = {
  shares: RotationShare[]
}

export const RotationDistribution = ({ shares }: RotationDistributionProps) => {
  const [hovered, setHovered] = useState<string | null>(null)
  const totalHa = shares.reduce((sum, entry) => sum + entry.areaHa, 0)
  const active = shares.find((entry) => shareKey(entry) === hovered)
  const colors = new Map<string, string>()
  let colorIndex = 0
  for (const entry of shares) {
    colors.set(
      shareKey(entry),
      entry.rotationVariant === null
        ? NO_ROTATION_COLOR
        : ROTATION_COLORS[colorIndex++ % ROTATION_COLORS.length],
    )
  }
  const gap = shares.length > 1 ? DONUT_GAP : 0
  // Rows with no area have no slice, so a farm of zero ha gets an empty ring.
  const arcs = shares
    .map((entry, index) => ({
      entry,
      length: Math.max(entry.share * DONUT_CIRCUMFERENCE - gap, 0.5),
      offset:
        shares
          .slice(0, index)
          .reduce((sum, earlier) => sum + earlier.share, 0) *
        DONUT_CIRCUMFERENCE,
    }))
    .filter(({ entry }) => entry.share > 0)
  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        className="size-28 shrink-0 @md:size-36"
        onMouseLeave={() => setHovered(null)}
      >
        {arcs.map(({ entry, length, offset: start }) => (
          <AppTooltip key={shareKey(entry)} content={shareTooltip(entry)}>
            <circle
              cx="50"
              cy="50"
              r={DONUT_RADIUS}
              fill="none"
              stroke={colors.get(shareKey(entry))}
              strokeWidth={DONUT_WIDTH}
              strokeDasharray={`${length} ${DONUT_CIRCUMFERENCE - length}`}
              strokeDashoffset={-start}
              transform="rotate(-90 50 50)"
              className={cn(
                'motion-safe:transition-opacity',
                hovered !== null && hovered !== shareKey(entry) && 'opacity-45',
              )}
              onMouseEnter={() => setHovered(shareKey(entry))}
            />
          </AppTooltip>
        ))}
        <text
          x="50"
          y="49"
          textAnchor="middle"
          fontSize="13"
          fontWeight="600"
          fill="currentColor"
          className="tabular-nums"
        >
          {active
            ? formatShare(active.share)
            : `${formatWholeNumber(totalHa)} ha`}
        </text>
        <text
          x="50"
          y="59"
          textAnchor="middle"
          fontSize="6.5"
          fill="currentColor"
          opacity="0.7"
        >
          {active ? shortShareLabel(active) : 'i alt'}
        </text>
      </svg>
      <ul aria-label="Sædskifter" className="flex w-full flex-col">
        {shares.map((entry) => {
          const withoutRotation = entry.rotationVariant === null
          const color = colors.get(shareKey(entry))
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
                <span
                  aria-hidden="true"
                  className="h-1 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${entry.share * 100}%`,
                      backgroundColor: color,
                    }}
                  />
                </span>
              </li>
            </AppTooltip>
          )
        })}
      </ul>
    </div>
  )
}
