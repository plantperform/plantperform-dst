import { useState } from 'react'

import { CropGroupTile } from '@/components/farm/CropGroupTile'
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
  const twoColumns = shares.length >= TWO_COLUMN_MIN_GROUPS
  const gap = shares.length > 1 ? DONUT_GAP : 0
  const arcs: { entry: CropShare; length: number; offset: number }[] = []
  let offset = 0
  for (const entry of shares) {
    const length = entry.share * DONUT_CIRCUMFERENCE
    arcs.push({ entry, length: Math.max(length - gap, 0.5), offset })
    offset += length
  }
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4',
        twoColumns
          ? '@sm:flex-row @sm:gap-3 @xl:gap-5'
          : '@md:flex-row @md:gap-5',
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        className={cn(
          'shrink-0',
          twoColumns ? 'size-36' : 'size-28 @md:size-36',
        )}
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
          'w-full min-w-0',
          twoColumns
            ? '@sm:w-auto @sm:flex-1 @sm:columns-2 @sm:gap-x-3 @sm:[column-rule:1px_solid_var(--color-border)] @xl:gap-x-4'
            : '@md:w-auto @md:flex-1',
        )}
      >
        {shares.map((entry) => (
          <li
            key={entry.group.id}
            className={cn(
              'grid break-inside-avoid items-center rounded-sm py-1 leading-5',
              twoColumns
                ? 'grid-cols-[auto_minmax(0,1fr)_2.25rem_auto] gap-x-1.5 px-0.5 text-xs @xl:gap-x-2 @xl:px-1 @xl:text-[13px] @2xl:grid-cols-[auto_minmax(0,1fr)_auto_2.5rem_auto]'
                : 'grid-cols-[auto_minmax(0,1fr)_2.5rem_auto] gap-x-2 px-1 text-[13px] @lg:grid-cols-[auto_minmax(0,1fr)_auto_2.5rem_auto]',
              hovered === entry.group.id && 'bg-muted',
            )}
            onMouseEnter={() => setHovered(entry.group.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <CropGroupTile group={entry.group} hasUndersownCrop={false} />
            <span className="truncate">{entry.group.label}</span>
            <span
              className={cn(
                'text-right text-[11px] text-muted-foreground tabular-nums',
                twoColumns ? 'hidden @2xl:block' : 'hidden @lg:block',
              )}
            >
              {formatNumber(entry.areaHa)} ha
            </span>
            <span className="text-right font-semibold tabular-nums">
              {formatWholeNumber(entry.share * 100)} %
            </span>
            <span
              className="text-right whitespace-nowrap tabular-nums"
              title={`${formatWholeNumber(entry.nLoadKgHa * entry.areaHa)} kg N i alt`}
            >
              {formatNumber(entry.nLoadKgHa)}{' '}
              <span className="text-[11px] text-muted-foreground">kg N/ha</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
