import { useState } from 'react'

import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
import type { CropGroup } from '@/lib/crop-groups'
import {
  formatNumber,
  formatWholeNumber,
  type CropShare,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const DONUT_RADIUS = 40
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS
const DONUT_GAP = 0.8
const TWO_COLUMN_MIN_GROUPS = 6

type CropDistributionProps = {
  shares: CropShare[]
}

export const CropDistribution = ({ shares }: CropDistributionProps) => {
  const [hovered, setHovered] = useState<CropGroup | null>(null)
  const totalHa = shares.reduce((sum, entry) => sum + entry.areaHa, 0)
  const active = shares.find((entry) => entry.group.id === hovered) ?? null
  const gap = shares.length > 1 ? DONUT_GAP : 0
  const arcs: { entry: CropShare; length: number; offset: number }[] = []
  let offset = 0
  for (const entry of shares) {
    const length = entry.share * DONUT_CIRCUMFERENCE
    arcs.push({ entry, length: Math.max(length - gap, 0.5), offset })
    offset += length
  }
  return (
    <div className="flex flex-col items-center gap-4 @md:flex-row @md:gap-5">
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        className="size-28 shrink-0 @md:size-36"
        onMouseLeave={() => setHovered(null)}
      >
        {arcs.map(({ entry, length, offset: start }) => (
          <circle
            key={entry.group.id}
            cx="50"
            cy="50"
            r={DONUT_RADIUS}
            fill="none"
            stroke={entry.group.color}
            strokeWidth="16"
            strokeDasharray={`${length} ${DONUT_CIRCUMFERENCE - length}`}
            strokeDashoffset={-start}
            transform="rotate(-90 50 50)"
            className={cn(
              'motion-safe:transition-opacity',
              hovered !== null && hovered !== entry.group.id && 'opacity-45',
            )}
            onMouseEnter={() => setHovered(entry.group.id)}
          />
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
            ? `${formatWholeNumber(active.share * 100)} %`
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
          {active ? active.group.label : 'i alt'}
        </text>
      </svg>
      <ul
        aria-label="Afgrødefordeling"
        className={cn(
          'w-full min-w-0 @md:w-auto @md:flex-1',
          shares.length >= TWO_COLUMN_MIN_GROUPS &&
            '@xl:columns-2 @xl:gap-x-4 @xl:[column-rule:1px_solid_var(--color-border)]',
        )}
      >
        {shares.map((entry) => (
          <li
            key={entry.group.id}
            className={cn(
              'grid break-inside-avoid grid-cols-[auto_minmax(0,1fr)_auto_2.5rem] items-center gap-x-2 rounded-sm px-1 py-1 text-[13px] leading-5',
              hovered === entry.group.id && 'bg-muted',
            )}
            onMouseEnter={() => setHovered(entry.group.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <CropYearSwatch
              color={entry.group.color}
              pattern={entry.group.pattern}
              hasUndersownCrop={false}
              size="8x12"
            />
            <span className="truncate">{entry.group.label}</span>
            <span className="text-right text-[11px] text-muted-foreground tabular-nums">
              {formatNumber(entry.areaHa)} ha
            </span>
            <span className="text-right font-semibold tabular-nums">
              {formatWholeNumber(entry.share * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
