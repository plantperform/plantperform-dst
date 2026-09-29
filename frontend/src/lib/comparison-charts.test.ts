import { createChartScene } from '@tanstack/charts'
import { describe, expect, it } from 'vitest'

import {
  chartLabel,
  db2NLoadChart,
  db2NLoadPoints,
  placeLabels,
  type Db2NLoadPoint,
} from '@/lib/comparison-charts'

const SIZE = { width: 400, height: 260 }

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
