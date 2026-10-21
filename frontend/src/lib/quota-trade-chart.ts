import { areaY, defineChart, dot, lineY, link, ruleY } from '@tanstack/charts'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'

import type { GainPoint } from '@/lib/quota-trade'

const LINE_PAINT = 'hsl(var(--primary))'
const ZERO_PAINT = 'hsl(var(--muted-foreground))'
const SUSPECT_PAINT = '#BA7517'
const CARD_PAINT = 'hsl(var(--card))'
// The proven range above each point: a faint band along the curve and a bar
// at each solved trade.
const RANGE_FILL_OPACITY = 0.14
const RANGE_STROKE_OPACITY = 0.55
const RANGE_STROKE_WIDTH = 3
const RANGE_CAP_RADIUS = 2.5
const DOT_RADIUS = 4
const HIGHLIGHT_RADIUS = 7
const PADDING_SHARE = 0.08

export type QuotaGainDatum = GainPoint & {
  key: string
  best: boolean
  selected: boolean
}

type QuotaGainChartOptions = {
  formatTrade: (tradeKg: number) => string
  formatGain: (gain: number) => string
  describe: (datum: QuotaGainDatum) => string
}

const paddedDomain = (
  values: number[],
  includeZero: boolean,
): [number, number] => {
  const all = includeZero ? [...values, 0] : values
  const min = Math.min(...all)
  const max = Math.max(...all)
  const padding = (max - min || Math.abs(max) || 1) * PADDING_SHARE
  return [min - padding, max + padding]
}

export const quotaGainChart = (
  data: QuotaGainDatum[],
  { formatTrade, formatGain, describe }: QuotaGainChartOptions,
) => {
  const highlighted = data.filter((datum) => datum.best || datum.selected)
  const ranged = data.filter(
    (datum): datum is QuotaGainDatum & { gainUpperBound: number } =>
      datum.gainUpperBound !== null,
  )
  return defineChart({
    marks: [
      areaY(ranged, {
        x: 'tradeKg',
        y1: 'gain',
        y2: 'gainUpperBound',
        fill: LINE_PAINT,
        fillOpacity: RANGE_FILL_OPACITY,
      }),
      link(ranged, {
        x1: 'tradeKg',
        y1: 'gain',
        x2: 'tradeKg',
        y2: 'gainUpperBound',
        key: 'key',
        stroke: LINE_PAINT,
        strokeOpacity: RANGE_STROKE_OPACITY,
        strokeWidth: RANGE_STROKE_WIDTH,
        lineCap: 'round',
      }),
      dot(ranged, {
        x: 'tradeKg',
        y: 'gainUpperBound',
        key: 'key',
        r: RANGE_CAP_RADIUS,
        fill: LINE_PAINT,
        fillOpacity: RANGE_STROKE_OPACITY,
      }),
      ruleY([{ gain: 0 }], {
        y: 'gain',
        stroke: ZERO_PAINT,
        strokeOpacity: 0.7,
        strokeDasharray: '4 3',
      }),
      lineY(data, {
        x: 'tradeKg',
        y: 'gain',
        stroke: LINE_PAINT,
        strokeWidth: 2,
      }),
      dot(data, {
        id: 'quota-points',
        x: 'tradeKg',
        y: 'gain',
        key: 'key',
        r: DOT_RADIUS,
        fill: LINE_PAINT,
        stroke: CARD_PAINT,
        strokeWidth: 1,
      }),
      dot(
        data.filter((datum) => datum.point.solutionFromTradeKg !== null),
        {
          x: 'tradeKg',
          y: 'gain',
          key: 'key',
          r: DOT_RADIUS,
          fill: SUSPECT_PAINT,
        },
      ),
      dot(highlighted, {
        id: 'quota-highlight',
        x: 'tradeKg',
        y: 'gain',
        key: 'key',
        r: HIGHLIGHT_RADIUS,
        fill: 'none',
        stroke: LINE_PAINT,
        strokeWidth: 2,
      }),
    ],
    scales: {
      x: {
        scale: scaleLinear().domain(
          paddedDomain(
            data.map((datum) => datum.tradeKg),
            true,
          ),
        ),
        grid: true,
        axis: { ticks: { format: formatTrade } },
      },
      y: {
        scale: scaleLinear().domain(
          paddedDomain(
            [
              ...data.map((datum) => datum.gain),
              ...ranged.map((datum) => datum.gainUpperBound),
            ],
            true,
          ),
        ),
        grid: true,
        axis: { ticks: { format: formatGain } },
      },
    },
    focusRing: false,
    maxFocusDistance: 24,
    tooltip: {
      use: tooltip,
      format: ({ datum }) => describe(datum as QuotaGainDatum),
      sticky: false,
    },
  })
}
