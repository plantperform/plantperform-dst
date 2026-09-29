import {
  barX,
  defineChart,
  dot,
  rect,
  ruleX,
  ruleY,
  text,
} from '@tanstack/charts'
import { decorative } from '@tanstack/charts/mark/decorative'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'

import {
  CROP_GROUP_INDEX,
  readableTextColor,
  type CropGroup,
  type CropGroupDefinition,
} from '@/lib/crop-groups'
import { formatNumber, formatShare, type CropShare } from '@/lib/field-domain'
import { overlayCurveTone, type CurveTone } from '@/lib/simulation-comparison'

type ChartColumn = {
  key: string
  title: string
  history: boolean
}

const PRIMARY_PAINT = 'hsl(var(--primary))'
const TONE_PAINT: Record<CurveTone, string> = {
  plain: '#8F8F89',
  history: '#B8B3A6',
  best: PRIMARY_PAINT,
  highlighted: '#1C1C1A',
  dimmed: '#DAD9D3',
}
const CARD_PAINT = 'hsl(var(--card))'
const TEXT_PAINT = 'hsl(var(--foreground))'
const MUTED_TEXT_PAINT = 'hsl(var(--muted-foreground))'

const LABEL_LENGTH = 22
const LABEL_OFFSET = 10
const HISTORY_LABEL_RISE = 12
const LEFT_LABELS_FROM = 0.6
const CLOSE_X = 0.3
const CLOSE_Y = 0.1
const HEADROOM = 1.04
const ROUND_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
const DOT_RADIUS = 6
const BETTER_AREA_OPACITY = 0.08

export const chartLabel = (title: string): string =>
  title.length <= LABEL_LENGTH
    ? title
    : `${title.slice(0, LABEL_LENGTH - 1).trimEnd()}…`

const roundUp = (value: number): number => {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step =
    ROUND_STEPS.find((candidate) => candidate * magnitude >= value) ?? 10
  return step * magnitude
}

const domainOf = (values: number[]): [number, number] => {
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  return [low < 0 ? -roundUp(-low * HEADROOM) : 0, roundUp(high * HEADROOM)]
}

const relativeTo = (values: number[]) => {
  const [low, high] = domainOf(values)
  return (value: number) => (value - low) / (high - low)
}

export type LabelSide = 'left' | 'right'

export const placeLabels = (
  points: { x: number; y: number }[],
): LabelSide[] => {
  const toX = relativeTo(points.map(({ x }) => x))
  const toY = relativeTo(points.map(({ y }) => y))
  const sides = points.map(
    ({ x }): LabelSide => (toX(x) > LEFT_LABELS_FROM ? 'left' : 'right'),
  )
  for (let first = 0; first < points.length; first++) {
    for (let second = first + 1; second < points.length; second++) {
      const [a, b] = [points[first], points[second]]
      const close =
        Math.abs(toX(a.x) - toX(b.x)) < CLOSE_X &&
        Math.abs(toY(a.y) - toY(b.y)) < CLOSE_Y
      if (!close || sides[first] !== sides[second]) continue
      sides[first] = a.x <= b.x ? 'left' : 'right'
      sides[second] = a.x <= b.x ? 'right' : 'left'
    }
  }
  return sides
}

export type Db2NLoadPoint = ChartColumn & {
  db2: number
  nLoad: number
  tone: CurveTone
}

export const db2NLoadPoints = (
  columns: (ChartColumn & { db2: number | null; nLoad: number | null })[],
  bestKey: string | null,
  highlightedKey: string | null,
): Db2NLoadPoint[] =>
  columns.flatMap(({ db2, nLoad, ...column }) =>
    db2 === null || nLoad === null
      ? []
      : [
          {
            ...column,
            db2,
            nLoad,
            tone: overlayCurveTone(column, bestKey, highlightedKey),
          },
        ],
  )

const dotPaint = ({ history, tone }: Db2NLoadPoint) =>
  history
    ? { fill: CARD_PAINT, stroke: TONE_PAINT[tone], strokeWidth: 2 }
    : { fill: TONE_PAINT[tone], stroke: CARD_PAINT, strokeWidth: 2 }

const labelPaint = ({ history, tone }: Db2NLoadPoint) => {
  if (tone === 'best') return PRIMARY_PAINT
  return history || tone === 'dimmed' ? MUTED_TEXT_PAINT : TEXT_PAINT
}

export type Db2NLoadChartOptions = {
  formatDb2: (value: number) => string
  formatNLoad: (value: number) => string
  describe: (point: Db2NLoadPoint) => string
}

export const db2NLoadChart = (
  points: Db2NLoadPoint[],
  { formatDb2, formatNLoad, describe }: Db2NLoadChartOptions,
) => {
  const xDomain = domainOf(points.map(({ nLoad }) => nLoad))
  const yDomain = domainOf(points.map(({ db2 }) => db2))
  const history = points.filter((point) => point.history)
  const sides = placeLabels(
    points.map(({ nLoad, db2 }) => ({ x: nLoad, y: db2 })),
  )
  const labels = points.map((point, index) => ({
    ...point,
    label: chartLabel(point.title),
    side: sides[index],
  }))
  const historyRule = {
    stroke: TONE_PAINT.history,
    strokeOpacity: 1,
    strokeDasharray: '4 3',
  }
  return defineChart({
    marks: [
      decorative(
        rect(history, {
          x1: () => xDomain[0],
          x2: 'nLoad',
          y1: 'db2',
          y2: () => yDomain[1],
          fill: PRIMARY_PAINT,
          fillOpacity: BETTER_AREA_OPACITY,
          inset: 0,
        }),
      ),
      ruleX(history, { x: 'nLoad', ...historyRule }),
      ruleY(history, { y: 'db2', ...historyRule }),
      ...points.map((point) =>
        dot([point], {
          id: `dot-${point.key}`,
          x: 'nLoad',
          y: 'db2',
          key: 'key',
          r: DOT_RADIUS,
          ...dotPaint(point),
        }),
      ),
      decorative(
        text(labels, {
          x: 'nLoad',
          y: 'db2',
          text: 'label',
          key: 'key',
          anchor: ({ side }) => (side === 'left' ? 'end' : 'start'),
          dx: ({ side }) => (side === 'left' ? -LABEL_OFFSET : LABEL_OFFSET),
          dy: ({ history }) => (history ? -HISTORY_LABEL_RISE : 0),
          fill: labelPaint,
          fontSize: 12,
          fontWeight: 500,
        }),
      ),
    ],
    scales: {
      x: {
        scale: scaleLinear().domain(xDomain),
        grid: true,
        axis: { ticks: { format: formatNLoad } },
      },
      y: {
        scale: scaleLinear().domain(yDomain),
        grid: true,
        axis: { ticks: { format: formatDb2 } },
      },
    },
    focusRing: false,
    maxFocusDistance: 24,
    tooltip: {
      use: tooltip,
      format: ({ datum }) => describe(datum),
      sticky: false,
    },
  })
}

export type CropColumn = ChartColumn & {
  shares: CropShare[] | undefined
}

export type CropSegment = {
  key: string
  columnKey: string
  title: string
  group: CropGroupDefinition
  share: number
  areaHa: number
  start: number
  end: number
}

const CROP_ROW_STEP = 44
const CROP_BAR_HEIGHT = 16
const CROP_NAME_OFFSET = 17
const NARROWEST_BAR = 400
const LABEL_CHAR_WIDTH = 6
const LABEL_PADDING = 10
const OUTSIDE_LABEL_GAP = 4
const OUTSIDE_LABEL_BEFORE_FROM = 0.85
const DIMMED_OPACITY = 0.35

export type CropFocus = {
  highlightedKey: string | null
  hoveredGroup: CropGroup | null
}

export type CropLabel = {
  key: string
  columnKey: string
  text: string
  x: number
  anchor: 'start' | 'middle' | 'end'
  dx: number
  fill: string
}

export const cropDistributionHeight = (rows: number): number =>
  rows * CROP_ROW_STEP + CROP_BAR_HEIGHT

export const cropSegments = (columns: CropColumn[]): CropSegment[] =>
  columns.flatMap(({ key, title, shares = [] }) => {
    const ordered = shares.toSorted(
      (left, right) =>
        CROP_GROUP_INDEX[left.group.id] - CROP_GROUP_INDEX[right.group.id],
    )
    return ordered.map((entry, index) => {
      const start = ordered
        .slice(0, index)
        .reduce((sum, previous) => sum + previous.share, 0)
      return {
        key: `${key}:${entry.id}`,
        columnKey: key,
        title,
        group: entry.group,
        share: entry.share,
        areaHa: entry.areaHa,
        start,
        end: start + entry.share,
      }
    })
  })

export const describeCropSegment = ({
  title,
  group,
  share,
  areaHa,
}: CropSegment): string =>
  `${title}\n${group.label}: ${formatShare(share)} · ${formatNumber(areaHa)} ha`

const isDimmed = (
  { group, columnKey }: CropSegment,
  { highlightedKey, hoveredGroup }: CropFocus,
) =>
  hoveredGroup !== null
    ? group.id !== hoveredGroup
    : highlightedKey !== null && columnKey !== highlightedKey

const fitsIn = (label: string, share: number) =>
  label.length * LABEL_CHAR_WIDTH + LABEL_PADDING <= share * NARROWEST_BAR

export const cropLabels = (
  segments: CropSegment[],
  focus: CropFocus,
): CropLabel[] =>
  segments.flatMap((segment): CropLabel[] => {
    if (isDimmed(segment, focus)) return []
    const { key, columnKey, group, share, start, end } = segment
    const percent = formatShare(share)
    const named = `${group.label} ${percent}`
    const inside = (label: string): CropLabel[] => [
      {
        key,
        columnKey,
        text: label,
        x: (start + end) / 2,
        anchor: 'middle',
        dx: 0,
        fill: readableTextColor(group.color),
      },
    ]
    if (fitsIn(named, share)) return inside(named)
    if (fitsIn(percent, share)) return inside(percent)
    if (focus.hoveredGroup !== group.id) return []
    const before = end > OUTSIDE_LABEL_BEFORE_FROM
    return [
      {
        key,
        columnKey,
        text: percent,
        x: before ? start : end,
        anchor: before ? 'end' : 'start',
        dx: before ? -OUTSIDE_LABEL_GAP : OUTSIDE_LABEL_GAP,
        fill: TEXT_PAINT,
      },
    ]
  })

export const cropDistributionChart = (
  columns: CropColumn[],
  focus: CropFocus,
) => {
  const segments = cropSegments(columns)
  const rowDimmed = (key: string) =>
    focus.hoveredGroup === null &&
    focus.highlightedKey !== null &&
    key !== focus.highlightedKey
  const names = columns.map(({ key, title, history }) => ({
    key,
    label: chartLabel(title),
    muted: history || rowDimmed(key),
  }))
  const bars = (id: string, source: CropSegment[], fillOpacity: number) =>
    barX(source, {
      id,
      x1: 'start',
      x2: 'end',
      y: 'columnKey',
      key: 'key',
      fill: ({ group }) => group.color,
      fillOpacity,
      stroke: CARD_PAINT,
      strokeWidth: 1,
    })
  return defineChart({
    marks: [
      bars(
        'shares',
        segments.filter((segment) => !isDimmed(segment, focus)),
        1,
      ),
      bars(
        'dimmed-shares',
        segments.filter((segment) => isDimmed(segment, focus)),
        DIMMED_OPACITY,
      ),
      decorative(
        text(names, {
          x: () => 0,
          y: 'key',
          text: 'label',
          key: 'key',
          anchor: 'start',
          dy: -CROP_NAME_OFFSET,
          fill: ({ muted }) => (muted ? MUTED_TEXT_PAINT : TEXT_PAINT),
          fontSize: 12,
          fontWeight: 500,
        }),
      ),
      decorative(
        text(cropLabels(segments, focus), {
          x: 'x',
          y: 'columnKey',
          text: 'text',
          key: 'key',
          anchor: ({ anchor }) => anchor,
          dx: ({ dx }) => dx,
          fill: ({ fill }) => fill,
          fontSize: 11,
          fontWeight: 500,
        }),
      ),
    ],
    scales: {
      x: { scale: scaleLinear().domain([0, 1]) },
      y: {
        scale: scaleBand<string>()
          .domain(columns.map(({ key }) => key))
          .paddingInner(1 - CROP_BAR_HEIGHT / CROP_ROW_STEP)
          .paddingOuter(0.5),
      },
    },
    guides: false,
    focusRing: false,
    tooltip: {
      use: tooltip,
      format: ({ datum }) => describeCropSegment(datum),
      sticky: false,
    },
  })
}
