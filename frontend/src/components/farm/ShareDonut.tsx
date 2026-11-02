import type { ReactNode } from 'react'

import { AppTooltip } from '@/components/ui/app-tooltip'
import { cn } from '@/lib/utils'

const DONUT_GAP = 0.8
const DONUT_EDGE = 0.6
// The outer ring gets thinner when an inner ring sits inside it, so the hole
// in the middle keeps its size.
const DONUT_RADIUS = 40
const DONUT_WIDTH = 16
const RINGED_DONUT_RADIUS = 44
const RINGED_DONUT_WIDTH = 12
const INNER_RING_RADIUS = 34.5
const INNER_RING_WIDTH = 5

export type DonutSlice = {
  id: string
  share: number
  color: string
  edgeColor?: string
  tooltip?: ReactNode
}

type Arc = { slice: DonutSlice; length: number; offset: number }

const arcsOf = (slices: DonutSlice[], circumference: number): Arc[] => {
  const gap = slices.length > 1 ? DONUT_GAP : 0
  let offset = 0
  return slices.map((slice) => {
    const length = slice.share * circumference
    const arc = { slice, length: Math.max(length - gap, 0.5), offset }
    offset += length
    return arc
  })
}

const withTooltip = (slice: DonutSlice, node: ReactNode) =>
  slice.tooltip ? (
    <AppTooltip key={slice.id} content={slice.tooltip}>
      {node}
    </AppTooltip>
  ) : (
    node
  )

const dimmedClassName = (hovered: string | null, id: string) =>
  cn(
    'motion-safe:transition-opacity',
    hovered !== null && hovered !== id && 'opacity-45',
  )

type ShareDonutProps = {
  slices: DonutSlice[]
  innerSlices?: DonutSlice[]
  hovered: string | null
  hoveredInner?: string | null
  onHover: (id: string) => void
  onHoverInner?: (id: string) => void
  onLeave: () => void
  value: string
  label: string
  className?: string
}

const NO_SLICES: DonutSlice[] = []

export const ShareDonut = ({
  slices,
  innerSlices = NO_SLICES,
  hovered,
  hoveredInner = null,
  onHover,
  onHoverInner,
  onLeave,
  value,
  label,
  className,
}: ShareDonutProps) => {
  const ringed = innerSlices.length > 0
  const radius = ringed ? RINGED_DONUT_RADIUS : DONUT_RADIUS
  const ringWidth = ringed ? RINGED_DONUT_WIDTH : DONUT_WIDTH
  const circumference = 2 * Math.PI * radius
  const innerCircumference = 2 * Math.PI * INNER_RING_RADIUS
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      className={className}
      onMouseLeave={onLeave}
    >
      {arcsOf(slices, circumference).map(({ slice, length, offset }) => {
        // With an edge colour the fill arc sits inside a slightly wider arc in
        // that colour, shortened at both ends, so every slice gets an outline.
        const edge = slice.edgeColor ? DONUT_EDGE : 0
        const fillLength = Math.max(length - 2 * edge, 0.25)
        return withTooltip(
          slice,
          <g
            key={slice.id}
            transform="rotate(-90 50 50)"
            className={dimmedClassName(hovered, slice.id)}
            onMouseEnter={() => onHover(slice.id)}
          >
            {slice.edgeColor ? (
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={slice.edgeColor}
                strokeWidth={ringWidth}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              />
            ) : null}
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={ringWidth - 2 * edge}
              strokeDasharray={`${fillLength} ${circumference - fillLength}`}
              strokeDashoffset={-(offset + edge)}
            />
          </g>,
        )
      })}
      {arcsOf(innerSlices, innerCircumference).map(
        ({ slice, length, offset }) =>
          withTooltip(
            slice,
            <circle
              key={slice.id}
              cx="50"
              cy="50"
              r={INNER_RING_RADIUS}
              fill="none"
              stroke={slice.color}
              strokeWidth={INNER_RING_WIDTH}
              strokeDasharray={`${length} ${innerCircumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
              className={dimmedClassName(hoveredInner, slice.id)}
              onMouseEnter={() => onHoverInner?.(slice.id)}
            />,
          ),
      )}
      <text
        x="50"
        y="49"
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        fill="currentColor"
        className="tabular-nums"
      >
        {value}
      </text>
      <text
        x="50"
        y="59"
        textAnchor="middle"
        fontSize="6.5"
        fill="currentColor"
        opacity="0.7"
      >
        {label}
      </text>
    </svg>
  )
}
