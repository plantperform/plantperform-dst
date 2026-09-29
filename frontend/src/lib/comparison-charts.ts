import { defineChart, dot, rect, ruleX, ruleY, text } from '@tanstack/charts'
import { decorative } from '@tanstack/charts/mark/decorative'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'

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
