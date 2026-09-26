import { Fragment, useState, type CSSProperties } from 'react'

import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { AppTooltip, TruncatedTooltip } from '@/components/ui/app-tooltip'
import {
  formatNumber,
  formatWholeNumber,
  type CropShare,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const DONUT_RADIUS = 40
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS
const DONUT_GAP = 0.8
const TWO_COLUMN_MIN_ROWS = 6

const formatShare = (share: number) => {
  const percent = share * 100
  if (percent > 0 && percent < 0.05) return '< 0,1 %'
  const text =
    percent > 0 && percent < 1
      ? formatNumber(percent)
      : formatWholeNumber(percent)
  return `${text} %`
}

type ColumnHeadingsProps = {
  className: string
  areaClassName: string
}

const ColumnHeadings = ({ className, areaClassName }: ColumnHeadingsProps) => (
  <li
    aria-hidden="true"
    className={cn(
      'border-b pb-1 text-[11px] leading-[14px] text-muted-foreground',
      className,
    )}
  >
    <span className="col-span-2">Afgrøde</span>
    <span className={cn('text-right', areaClassName)}>Areal</span>
    <span className="text-right">
      Udledning
      <span className="block">kg N/ha</span>
    </span>
  </li>
)

type CropDistributionProps = {
  shares: CropShare[]
}

export const CropDistribution = ({ shares }: CropDistributionProps) => {
  const [hovered, setHovered] = useState<string | null>(null)
  const totalHa = shares.reduce((sum, entry) => sum + entry.areaHa, 0)
  const active = shares.find((entry) => entry.id === hovered) ?? null
  const twoColumns = shares.length >= TWO_COLUMN_MIN_ROWS
  const firstColumnSize = twoColumns
    ? Math.ceil(shares.length / 2)
    : shares.length
  const rowClassName = cn(
    'col-span-4 grid grid-cols-subgrid px-1',
    twoColumns ? '@3xl:col-span-5' : '@lg:col-span-5',
  )
  const sideClassName = (index: number) =>
    twoColumns
      ? index < firstColumnSize
        ? '@sm:pr-2'
        : '@sm:border-l @sm:pl-2'
      : ''
  const areaSpanClassName = twoColumns ? '@3xl:col-span-2' : '@lg:col-span-2'
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
          ? '@lg:flex-row @lg:gap-3 @xl:gap-5'
          : '@md:flex-row @md:gap-5',
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        className={cn(
          'size-28 shrink-0',
          twoColumns
            ? '@lg:sticky @lg:top-0 @lg:self-start @xl:size-36'
            : '@md:sticky @md:top-0 @md:self-start @md:size-36',
        )}
        onMouseLeave={() => setHovered(null)}
      >
        {arcs.map(({ entry, length, offset: start }) => (
          <circle
            key={entry.id}
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
              hovered !== null && hovered !== entry.id && 'opacity-45',
            )}
            onMouseEnter={() => setHovered(entry.id)}
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
          {active ? active.label : 'i alt'}
        </text>
      </svg>
      <ul
        aria-label="Afgrødefordeling"
        className={cn(
          'grid w-full min-w-0 content-start grid-cols-[auto_minmax(0,1fr)_auto_auto]',
          twoColumns
            ? 'gap-x-1.5 text-xs @sm:grid-flow-col @sm:grid-cols-[repeat(2,auto_minmax(0,1fr)_auto_auto)] @sm:grid-rows-[repeat(var(--rows),auto)] @lg:w-auto @lg:flex-1 @xl:gap-x-2 @xl:text-[13px] @3xl:grid-cols-[repeat(2,auto_minmax(0,1fr)_auto_auto_auto)]'
            : 'gap-x-2 text-[13px] @md:w-auto @md:flex-1 @lg:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]',
        )}
        style={
          twoColumns
            ? ({ '--rows': firstColumnSize + 1 } as CSSProperties)
            : undefined
        }
      >
        <ColumnHeadings
          className={cn(rowClassName, sideClassName(0))}
          areaClassName={areaSpanClassName}
        />
        {shares.map((entry, index) => (
          <Fragment key={entry.id}>
            {twoColumns && index === firstColumnSize ? (
              <ColumnHeadings
                className={cn(
                  rowClassName,
                  sideClassName(index),
                  'hidden @sm:grid',
                )}
                areaClassName={areaSpanClassName}
              />
            ) : null}
            <li
              className={cn(
                rowClassName,
                sideClassName(index),
                'items-center border-b border-border/60 py-1 leading-5',
                hovered === entry.id && 'bg-muted',
              )}
              onMouseEnter={() => setHovered(entry.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <CropGroupTile group={entry.group} />
              <TruncatedTooltip content={entry.label} className="truncate">
                {entry.label}
              </TruncatedTooltip>
              <span
                className={cn(
                  'text-right text-[11px] text-muted-foreground tabular-nums',
                  twoColumns ? 'hidden @3xl:block' : 'hidden @lg:block',
                )}
              >
                {formatNumber(entry.areaHa)} ha
              </span>
              <span className="text-right font-semibold tabular-nums">
                {formatShare(entry.share)}
                <span className="sr-only"> af arealet, udledning</span>
              </span>
              <AppTooltip
                content={`${formatWholeNumber(entry.nLoadKgHa * entry.areaHa)} kg N i alt`}
              >
                <span className="text-right tabular-nums">
                  {formatNumber(entry.nLoadKgHa)}
                  <span className="sr-only"> kg N pr. hektar</span>
                </span>
              </AppTooltip>
            </li>
          </Fragment>
        ))}
      </ul>
    </div>
  )
}
