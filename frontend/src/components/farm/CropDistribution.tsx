import { Fragment, useState, type CSSProperties } from 'react'

import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { WinterCoverSwatch } from '@/components/farm/WinterCoverBand'
import { AppTooltip, TruncatedTooltip } from '@/components/ui/app-tooltip'
import { cropEdgeColor, shortCropName } from '@/lib/crop-groups'
import {
  EXCLUDED_FROM_CALCULATION,
  formatHectares,
  formatNumber,
  formatShare,
  formatWholeNumber,
  type CropShare,
} from '@/lib/field-domain'
import type { WinterCoverShare } from '@/lib/winter-cover-overview'
import { cn } from '@/lib/utils'

const DONUT_GAP = 0.8
const DONUT_EDGE = 0.6
// The crop ring gets thinner when the winter cover ring sits inside it, so the
// hole in the middle keeps its size.
const DONUT_RADIUS = 40
const DONUT_WIDTH = 16
const RINGED_DONUT_RADIUS = 44
const RINGED_DONUT_WIDTH = 12
const COVER_RING_RADIUS = 34.5
const COVER_RING_WIDTH = 5
const TWO_COLUMN_MIN_ROWS = 6
const ROW_CLASS_NAME = 'col-span-4 grid grid-cols-subgrid px-1'

type ColumnHeadingsProps = {
  className: string
}

const ColumnHeadings = ({ className }: ColumnHeadingsProps) => (
  <li
    aria-hidden="true"
    className={cn(
      'border-b pb-1 text-[11px] leading-[14px] text-muted-foreground',
      className,
    )}
  >
    <span className="col-span-2">Afgrøde</span>
    <span className="text-right">
      Areal
      <span className="block">ha</span>
    </span>
    <span className="text-right">
      Udledning
      <span className="block">kg N/ha</span>
    </span>
  </li>
)

const formatArea = (areaHa: number) =>
  areaHa > 0 && areaHa < 0.1 ? '< 0,1' : formatHectares(areaHa)

type CropDistributionProps = {
  shares: CropShare[]
  winterCover?: WinterCoverShare[]
}

const NO_WINTER_COVER: WinterCoverShare[] = []

export const CropDistribution = ({
  shares,
  winterCover = NO_WINTER_COVER,
}: CropDistributionProps) => {
  const [hovered, setHovered] = useState<string | null>(null)
  const [hoveredCover, setHoveredCover] = useState<string | null>(null)
  const totalHa = shares.reduce((sum, entry) => sum + entry.areaHa, 0)
  const active = shares.find((entry) => entry.id === hovered) ?? null
  const activeCover =
    winterCover.find((entry) => entry.id === hoveredCover) ?? null
  const ringed = winterCover.length > 0
  const radius = ringed ? RINGED_DONUT_RADIUS : DONUT_RADIUS
  const ringWidth = ringed ? RINGED_DONUT_WIDTH : DONUT_WIDTH
  const circumference = 2 * Math.PI * radius
  const coverCircumference = 2 * Math.PI * COVER_RING_RADIUS
  const coverGap = winterCover.length > 1 ? DONUT_GAP : 0
  const coverArcs: {
    entry: WinterCoverShare
    length: number
    offset: number
  }[] = []
  let coverOffset = 0
  for (const entry of winterCover) {
    const length = entry.share * coverCircumference
    coverArcs.push({
      entry,
      length: Math.max(length - coverGap, 0.5),
      offset: coverOffset,
    })
    coverOffset += length
  }
  const twoColumns = shares.length >= TWO_COLUMN_MIN_ROWS
  const firstColumnSize = twoColumns
    ? Math.ceil(shares.length / 2)
    : shares.length
  const sideClassName = (index: number) =>
    twoColumns
      ? index < firstColumnSize
        ? '@sm:pr-2'
        : '@sm:border-l @sm:pl-2'
      : ''
  const gap = shares.length > 1 ? DONUT_GAP : 0
  const arcs: { entry: CropShare; length: number; offset: number }[] = []
  let offset = 0
  for (const entry of shares) {
    const length = entry.share * circumference
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
        onMouseLeave={() => {
          setHovered(null)
          setHoveredCover(null)
        }}
      >
        {arcs.map(({ entry, length, offset: start }) => {
          // The fill arc sits inside a slightly wider arc in the edge colour,
          // shortened at both ends, so every slice gets an outline.
          const fillLength = Math.max(length - 2 * DONUT_EDGE, 0.25)
          return (
            <g
              key={entry.id}
              transform="rotate(-90 50 50)"
              className={cn(
                'motion-safe:transition-opacity',
                hovered !== null && hovered !== entry.id && 'opacity-45',
              )}
              onMouseEnter={() => {
                setHovered(entry.id)
                setHoveredCover(null)
              }}
            >
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={cropEdgeColor(entry.color)}
                strokeWidth={ringWidth}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-start}
              />
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={entry.color}
                strokeWidth={ringWidth - 2 * DONUT_EDGE}
                strokeDasharray={`${fillLength} ${circumference - fillLength}`}
                strokeDashoffset={-(start + DONUT_EDGE)}
              />
            </g>
          )
        })}
        {coverArcs.map(({ entry, length, offset: start }) => (
          <AppTooltip
            key={entry.id}
            content={`${entry.label} · ${formatNumber(entry.areaHa)} ha · ${formatShare(entry.share)}. ${entry.description}`}
          >
            <circle
              cx="50"
              cy="50"
              r={COVER_RING_RADIUS}
              fill="none"
              stroke={entry.color}
              strokeWidth={COVER_RING_WIDTH}
              strokeDasharray={`${length} ${coverCircumference - length}`}
              strokeDashoffset={-start}
              transform="rotate(-90 50 50)"
              className={cn(
                'motion-safe:transition-opacity',
                hoveredCover !== null &&
                  hoveredCover !== entry.id &&
                  'opacity-45',
              )}
              onMouseEnter={() => {
                setHovered(null)
                setHoveredCover(entry.id)
              }}
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
            : activeCover
              ? formatShare(activeCover.share)
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
          {active
            ? shortCropName(active.label)
            : activeCover
              ? shortCropName(activeCover.label)
              : 'i alt'}
        </text>
      </svg>
      <div
        className={cn(
          'flex w-full min-w-0 flex-col gap-3',
          twoColumns ? '@lg:w-auto @lg:flex-1' : '@md:w-auto @md:flex-1',
        )}
      >
        <ul
          aria-label="Afgrødefordeling"
          className={cn(
            'grid w-full min-w-0 content-start grid-cols-[auto_minmax(0,1fr)_auto_auto]',
            twoColumns
              ? 'gap-x-1.5 text-xs @sm:grid-flow-col @sm:grid-cols-[repeat(2,auto_minmax(0,1fr)_auto_auto)] @sm:grid-rows-[repeat(var(--rows),auto)] @xl:gap-x-2 @xl:text-[13px]'
              : 'gap-x-2 text-[13px]',
          )}
          style={
            twoColumns
              ? ({ '--rows': firstColumnSize + 1 } as CSSProperties)
              : undefined
          }
        >
          <ColumnHeadings className={cn(ROW_CLASS_NAME, sideClassName(0))} />
          {shares.map((entry, index) => (
            <Fragment key={entry.id}>
              {twoColumns && index === firstColumnSize ? (
                <ColumnHeadings
                  className={cn(
                    ROW_CLASS_NAME,
                    sideClassName(index),
                    'hidden @sm:grid',
                  )}
                />
              ) : null}
              <li
                className={cn(
                  ROW_CLASS_NAME,
                  sideClassName(index),
                  'items-center border-b border-border/60 py-1 leading-5',
                  hovered === entry.id && 'bg-muted',
                )}
                onMouseEnter={() => {
                  setHovered(entry.id)
                  setHoveredCover(null)
                }}
                onMouseLeave={() => setHovered(null)}
              >
                <CropGroupTile group={entry.group} color={entry.color} />
                <TruncatedTooltip content={entry.label} className="truncate">
                  {entry.label}
                </TruncatedTooltip>
                <span className="text-right font-semibold tabular-nums">
                  {formatArea(entry.areaHa)}
                  <span className="sr-only"> hektar, udledning</span>
                </span>
                {entry.nLoadKgHa === null ? (
                  <AppTooltip content={EXCLUDED_FROM_CALCULATION}>
                    <span className="text-right text-muted-foreground">-</span>
                  </AppTooltip>
                ) : (
                  <AppTooltip
                    content={`${formatWholeNumber(entry.nLoadKg)} kg N i alt`}
                  >
                    <span className="text-right tabular-nums">
                      {formatNumber(entry.nLoadKgHa)}
                      <span className="sr-only"> kg N pr. hektar</span>
                    </span>
                  </AppTooltip>
                )}
              </li>
            </Fragment>
          ))}
        </ul>
        {ringed ? (
          <ul
            aria-label="Vinterdække"
            className={cn(
              'grid w-full min-w-0 content-start grid-cols-[auto_minmax(0,1fr)_auto]',
              twoColumns
                ? 'gap-x-1.5 text-xs @xl:gap-x-2 @xl:text-[13px]'
                : 'gap-x-2 text-[13px]',
            )}
          >
            <li
              aria-hidden="true"
              className="col-span-3 grid grid-cols-subgrid border-b px-1 pb-1 text-[11px] leading-[14px] text-muted-foreground"
            >
              <span className="col-span-2">Vinterdække (indre ring)</span>
              <span className="text-right">
                Areal
                <span className="block">ha</span>
              </span>
            </li>
            {winterCover.map((entry) => (
              <AppTooltip
                key={entry.id}
                content={`${entry.label} · ${formatShare(entry.share)}. ${entry.description}`}
              >
                <li
                  className={cn(
                    'col-span-3 grid grid-cols-subgrid items-center border-b border-border/60 px-1 py-1 leading-5',
                    hoveredCover === entry.id && 'bg-muted',
                  )}
                  onMouseEnter={() => {
                    setHovered(null)
                    setHoveredCover(entry.id)
                  }}
                  onMouseLeave={() => setHoveredCover(null)}
                >
                  <WinterCoverSwatch
                    cover={{
                      id: entry.id,
                      label: entry.label,
                      description: entry.description,
                      color: entry.color,
                    }}
                  />
                  <span className="min-w-0 truncate">{entry.label}</span>
                  <span className="text-right font-semibold tabular-nums">
                    {formatArea(entry.areaHa)}
                    <span className="sr-only"> hektar</span>
                  </span>
                </li>
              </AppTooltip>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
