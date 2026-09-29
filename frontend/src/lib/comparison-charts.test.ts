import { createChartScene } from '@tanstack/charts'
import { describe, expect, it } from 'vitest'

import {
  chartLabel,
  cropDistributionChart,
  cropLabels,
  cropSegments,
  db2NLoadChart,
  db2NLoadPoints,
  describeCropSegment,
  placeLabels,
  type CropColumn,
  type CropFocus,
  type Db2NLoadPoint,
} from '@/lib/comparison-charts'
import { cropGroupDefinition, type CropGroup } from '@/lib/crop-groups'
import type { CropShare } from '@/lib/field-domain'

const SIZE = { width: 400, height: 260 }

const share = (id: CropGroup, value: number): CropShare => {
  const group = cropGroupDefinition(id)
  return {
    id,
    label: group.label,
    group,
    areaHa: value * 100,
    share: value,
    nLoadKgHa: 0,
  }
}

describe('db2NLoadPoints', () => {
  const columns = [
    {
      key: 'history',
      title: 'Afgrødehistorik',
      history: true,
      db2: 323_000,
      nLoad: 572,
    },
    { key: 'a', title: 'Test 2', history: false, db2: 766_000, nLoad: 213 },
    { key: 'b', title: 'Test 3', history: false, db2: null, nLoad: null },
  ]

  it('leaves out columns without figures', () => {
    expect(db2NLoadPoints(columns, 'a', null).map(({ key }) => key)).toEqual([
      'history',
      'a',
    ])
  })

  it('tones the points like the catchment curves', () => {
    expect(db2NLoadPoints(columns, 'a', null).map(({ tone }) => tone)).toEqual([
      'history',
      'best',
    ])
    expect(
      db2NLoadPoints(columns, 'a', 'history').map(({ tone }) => tone),
    ).toEqual(['highlighted', 'dimmed'])
  })
})

describe('placeLabels', () => {
  it('puts the label left of a point in the right part of the chart', () => {
    expect(
      placeLabels([
        { x: 2, y: 10 },
        { x: 9, y: 4 },
      ]),
    ).toEqual(['right', 'left'])
  })

  it('puts the labels of two close points on each side', () => {
    expect(
      placeLabels([
        { x: 11.2, y: 2_555 },
        { x: 4.2, y: 14_990 },
        { x: 4.5, y: 14_843 },
        { x: 6.8, y: 5_065 },
      ]),
    ).toEqual(['left', 'left', 'right', 'right'])
  })
})

describe('chartLabel', () => {
  it('keeps short titles', () => {
    expect(chartLabel('Test 2')).toBe('Test 2')
  })

  it('shortens long titles', () => {
    expect(chartLabel('Mere græs og færre roer fra 2027')).toBe(
      'Mere græs og færre ro…',
    )
  })
})

describe('db2NLoadChart', () => {
  const points: Db2NLoadPoint[] = [
    {
      key: 'history',
      title: 'Afgrødehistorik',
      history: true,
      db2: 323_000,
      nLoad: 572,
      tone: 'history',
    },
    {
      key: 'a',
      title: 'Test 2',
      history: false,
      db2: 766_000,
      nLoad: 213,
      tone: 'best',
    },
    {
      key: 'b',
      title: 'Test 1',
      history: false,
      db2: 758_000,
      nLoad: 227,
      tone: 'plain',
    },
  ]
  const scene = createChartScene(
    db2NLoadChart(points, {
      formatDb2: String,
      formatNLoad: String,
      describe: ({ title }) => title,
    }),
    SIZE,
  )

  it('makes only the dots interactive', () => {
    expect(scene.points.map(({ datum }) => datum.key)).toEqual([
      'history',
      'a',
      'b',
    ])
  })

  it('runs both axes from zero to a round number above the largest value', () => {
    expect(scene.scales.x.domain).toEqual([0, 600])
    expect(scene.scales.y.domain).toEqual([0, 800_000])
  })
})

describe('cropSegments', () => {
  it('stacks the shares of a column in crop group order', () => {
    expect(
      cropSegments([
        {
          key: 'a',
          title: 'Test 2',
          history: false,
          shares: [share('grass', 0.75), share('winterCereal', 0.25)],
        },
      ]).map(({ group, start, end }) => [group.id, start, end]),
    ).toEqual([
      ['winterCereal', 0, 0.25],
      ['grass', 0.25, 1],
    ])
  })

  it('leaves out columns without shares', () => {
    expect(
      cropSegments([
        { key: 'a', title: 'Test 2', history: false, shares: undefined },
      ]),
    ).toEqual([])
  })
})

describe('describeCropSegment', () => {
  const describeShare = (value: number) => {
    const [segment] = cropSegments([
      {
        key: 'a',
        title: 'Test 2',
        history: false,
        shares: [share('grass', value)],
      },
    ])
    return describeCropSegment(segment)
  }

  it('names the column, the crop group, its share and its area', () => {
    expect(describeShare(0.344)).toBe('Test 2\nGræs: 34 % · 34,4 ha')
  })

  it('keeps a decimal for shares under one percent', () => {
    expect(describeShare(0.0042)).toBe('Test 2\nGræs: 0,4 % · 0,4 ha')
  })
})

describe('cropLabels', () => {
  const noFocus: CropFocus = { highlightedKey: null, hoveredGroup: null }
  const labelsFor = (value: number, focus: CropFocus = noFocus) =>
    cropLabels(
      cropSegments([
        {
          key: 'a',
          title: 'Test 2',
          history: false,
          shares: [share('winterCereal', value), share('grass', 1 - value)],
        },
      ]),
      focus,
    ).find(({ key }) => key === 'a:winterCereal')

  it('names the crop group when there is room', () => {
    expect(labelsFor(0.75)?.text).toBe('Vintersæd 75 %')
  })

  it('shows only the share when the name does not fit', () => {
    expect(labelsFor(0.1)?.text).toBe('10 %')
  })

  it('leaves out shares too small for a label', () => {
    expect(labelsFor(0.05)).toBeUndefined()
  })

  it('writes a small share of the hovered crop group next to it', () => {
    expect(
      labelsFor(0.05, { highlightedKey: null, hoveredGroup: 'winterCereal' }),
    ).toMatchObject({ text: '5 %', x: 0.05, anchor: 'start' })
  })

  it('labels only the hovered crop group', () => {
    expect(
      labelsFor(0.75, { highlightedKey: null, hoveredGroup: 'grass' }),
    ).toBeUndefined()
  })
})

describe('cropDistributionChart', () => {
  const columns: CropColumn[] = [
    {
      key: 'history',
      title: 'Afgrødehistorik',
      history: true,
      shares: [share('grass', 0.75), share('winterCereal', 0.25)],
    },
    {
      key: 'a',
      title: 'Test 2',
      history: false,
      shares: [share('springCereal', 1)],
    },
  ]
  it('draws each share from its start to its end', () => {
    const scene = createChartScene(
      cropDistributionChart(columns, {
        highlightedKey: null,
        hoveredGroup: null,
      }),
      SIZE,
    )
    const history = scene.points.filter(
      ({ datum }) => datum.columnKey === 'history',
    )
    expect(
      Object.fromEntries(
        history.map(({ datum, x1Value, x2Value }) => [
          datum.group.id,
          [x1Value, x2Value],
        ]),
      ),
    ).toEqual({ winterCereal: [0, 0.25], grass: [0.25, 1] })
  })

  it('dims the columns that are not highlighted', () => {
    const scene = createChartScene(
      cropDistributionChart(columns, {
        highlightedKey: 'a',
        hoveredGroup: null,
      }),
      SIZE,
    )
    expect(
      scene.points.map(({ datum, markId }) => [datum.columnKey, markId]),
    ).toEqual([
      ['a', 'shares'],
      ['history', 'dimmed-shares'],
      ['history', 'dimmed-shares'],
    ])
  })

  it('dims the other crop groups while one is hovered', () => {
    const scene = createChartScene(
      cropDistributionChart(columns, {
        highlightedKey: 'a',
        hoveredGroup: 'grass',
      }),
      SIZE,
    )
    expect(
      scene.points.map(({ datum, markId }) => [datum.key, markId]),
    ).toEqual([
      ['history:grass', 'shares'],
      ['history:winterCereal', 'dimmed-shares'],
      ['a:springCereal', 'dimmed-shares'],
    ])
  })
})
