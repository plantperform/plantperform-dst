import { describe, expect, it } from 'vitest'

import type { FieldRecord } from '@/api/types'
import type { CatchmentRun } from '@/lib/field-domain'
import {
  fieldListItems,
  widestItems,
  withGaps,
  withGroupRows,
} from '@/lib/field-list-rows'

const field = (id: string) => ({ id }) as FieldRecord

const run = (firstFieldId: string, catchmentId: number) =>
  ({ firstFieldId, catchmentId }) as CatchmentRun

describe('fieldListItems', () => {
  it('puts a kystvandopland row before the first mark of each run', () => {
    const north = run('a', 1)
    const south = run('c', 2)
    const runStarts = new Map([
      ['a', north],
      ['c', south],
    ])

    expect(
      fieldListItems([field('a'), field('b'), field('c')], runStarts),
    ).toEqual([
      { kind: 'group', key: 'group:a', run: north },
      { kind: 'field', key: 'a', rowIndex: 0 },
      { kind: 'field', key: 'b', rowIndex: 1 },
      { kind: 'group', key: 'group:c', run: south },
      { kind: 'field', key: 'c', rowIndex: 2 },
    ])
  })
})

describe('withGroupRows', () => {
  it('adds every kystvandopland row to the window, in list order', () => {
    expect(withGroupRows([40, 41, 42], [0, 30, 90])).toEqual([
      0, 30, 40, 41, 42, 90,
    ])
  })

  it('keeps a kystvandopland row once when the window holds it', () => {
    expect(withGroupRows([29, 30, 31], [0, 30])).toEqual([0, 29, 30, 31])
  })
})

describe('withGaps', () => {
  it('fills the space before, between and after the rendered rows', () => {
    expect(
      withGaps(
        [
          { index: 3, start: 100, end: 129 },
          { index: 20, start: 800, end: 840 },
          { index: 21, start: 840, end: 880 },
        ],
        0,
        2000,
      ),
    ).toEqual([
      { kind: 'gap', key: 'gap:0', height: 100 },
      { kind: 'row', index: 3 },
      { kind: 'gap', key: 'gap:2', height: 671 },
      { kind: 'row', index: 20 },
      { kind: 'row', index: 21 },
      { kind: 'gap', key: 'gap:5', height: 1120 },
    ])
  })

  it('adds nothing when every row is rendered', () => {
    expect(
      withGaps(
        [
          { index: 0, start: 44, end: 84 },
          { index: 1, start: 84, end: 124 },
        ],
        44,
        124,
      ),
    ).toEqual([
      { kind: 'row', index: 0 },
      { kind: 'row', index: 1 },
    ])
  })

  it('is one gap when nothing is rendered yet', () => {
    expect(withGaps([], 44, 444)).toEqual([
      { kind: 'gap', key: 'gap:0', height: 400 },
    ])
  })
})

describe('widestItems', () => {
  const marks = [
    { name: '7-0', area: 12.5 },
    { name: '118-11', area: 3 },
    { name: '9-1', area: 140.2 },
  ]

  it('picks the widest item for each hint', () => {
    expect(
      widestItems(marks, [
        (mark) => mark.name.length,
        (mark) => String(mark.area).length,
      ]),
    ).toEqual([marks[1], marks[2]])
  })

  it('keeps an item once when it is widest for several hints', () => {
    expect(
      widestItems(marks, [
        (mark) => mark.name.length,
        (mark) => mark.name.length,
      ]),
    ).toEqual([marks[1]])
  })

  it('picks nothing for a hint that no item has a width for', () => {
    expect(widestItems(marks, [() => 0])).toEqual([])
  })
})
