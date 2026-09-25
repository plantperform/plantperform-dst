import { describe, expect, it } from 'vitest'

import type { CatchmentTotalsByYear } from '@/lib/field-domain'
import {
  describeCatchmentYearStatus,
  describeDb2Delta,
  describeFieldChanges,
  describeNLoadDelta,
  summarizeCatchmentYearStatuses,
} from '@/lib/simulation-overview'

const years = (entries: Record<number, [nLoadKg: number, quotaKgN: number]>) =>
  Object.fromEntries(
    Object.entries(entries).map(([year, [nLoadKg, quotaKgN]]) => [
      Number(year),
      { nLoadKg, quotaKgN, fieldCount: 1 },
    ]),
  )

describe('summarizeCatchmentYearStatuses', () => {
  it('lists the calendar years a simulation is over the quota', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 1: [90, 100], 2: [110, 100], 3: [80, 100], 6: [120, 100] })],
    ])
    expect(summarizeCatchmentYearStatuses(totals, false)).toEqual([
      { catchmentId: 7, level: 'over', overYears: [2028, 2032] },
    ])
  })

  it('keeps the calendar years of the crop history', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 2019: [80, 100], 2021: [105, 100] })],
    ])
    expect(summarizeCatchmentYearStatuses(totals, true)).toEqual([
      { catchmentId: 7, level: 'over', overYears: [2021] },
    ])
  })

  it('is near the quota when no year is over but the average is at least 90 %', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 1: [95, 100], 2: [88, 100] })],
    ])
    expect(summarizeCatchmentYearStatuses(totals, false)).toEqual([
      { catchmentId: 7, level: 'near', overYears: [] },
    ])
  })

  it('is under the quota when the average is below 90 %', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 1: [70, 100], 2: [90, 100] })],
    ])
    expect(summarizeCatchmentYearStatuses(totals, false)).toEqual([
      { catchmentId: 7, level: 'ok', overYears: [] },
    ])
  })

  it('has no quota when no year carries one', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 1: [40, 0], 2: [50, 0] })],
    ])
    expect(summarizeCatchmentYearStatuses(totals, false)).toEqual([
      { catchmentId: 7, level: 'noData', overYears: [] },
    ])
  })

  it('skips fields without a kystvandopland and sorts by catchment', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [12, years({ 1: [10, 100] })],
      [null, years({ 1: [500, 0] })],
      [3, years({ 1: [10, 100] })],
    ])
    expect(
      summarizeCatchmentYearStatuses(totals, false).map(
        (status) => status.catchmentId,
      ),
    ).toEqual([3, 12])
  })

  it('has no statuses before any field has figures', () => {
    expect(summarizeCatchmentYearStatuses(new Map(), false)).toEqual([])
  })
})

describe('describeCatchmentYearStatus', () => {
  it('names every year over the quota', () => {
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'over',
        overYears: [2028],
      }),
    ).toBe('Over kvoten i 2028')
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'over',
        overYears: [2028, 2032],
      }),
    ).toBe('Over kvoten i 2028 og 2032')
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'over',
        overYears: [2028, 2030, 2032],
      }),
    ).toBe('Over kvoten i 2028, 2030 og 2032')
  })

  it('joins three or more years in a row into a period', () => {
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'over',
        overYears: [2019, 2020, 2021, 2022, 2023, 2025, 2026],
      }),
    ).toBe('Over kvoten i 2019-2023, 2025 og 2026')
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'over',
        overYears: [2027, 2030, 2031, 2032],
      }),
    ).toBe('Over kvoten i 2027 og 2030-2032')
  })

  it('keeps two years in a row apart', () => {
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'over',
        overYears: [2019, 2020, 2022, 2023],
      }),
    ).toBe('Over kvoten i 2019, 2020, 2022 og 2023')
  })

  it('describes the other levels', () => {
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'near',
        overYears: [],
      }),
    ).toBe('Tæt på kvoten')
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'ok',
        overYears: [],
      }),
    ).toBe('Under kvoten')
    expect(
      describeCatchmentYearStatus({
        catchmentId: 1,
        level: 'noData',
        overYears: [],
      }),
    ).toBe('Ingen kvote')
  })
})

describe('describeDb2Delta', () => {
  it('shows a gain in kroner and percent as better', () => {
    expect(describeDb2Delta(1_045_000, 1_000_000)).toEqual({
      text: '+45 t.kr (4,5 %)',
      tone: 'better',
    })
  })

  it('shows a loss as worse', () => {
    expect(describeDb2Delta(970_000, 1_000_000)).toEqual({
      text: '−30 t.kr (3 %)',
      tone: 'worse',
    })
  })

  it('rounds the percent to whole numbers from 10 %', () => {
    expect(describeDb2Delta(1_123_400, 1_000_000)).toEqual({
      text: '+123 t.kr (12 %)',
      tone: 'better',
    })
  })

  it('leaves out a percent that rounds to zero', () => {
    expect(describeDb2Delta(1_000_400, 1_000_000)).toEqual({
      text: '+400 kr',
      tone: 'better',
    })
  })

  it('leaves out the percent when the crop history has no DB2', () => {
    expect(describeDb2Delta(500, 0)).toEqual({
      text: '+500 kr',
      tone: 'better',
    })
  })

  it('is the same when nothing changed', () => {
    expect(describeDb2Delta(1_000_000, 1_000_000)).toEqual({
      text: '±0 kr',
      tone: 'same',
    })
  })
})

describe('describeNLoadDelta', () => {
  it('shows less N load as better', () => {
    expect(describeNLoadDelta(880, 1_000)).toEqual({
      text: '−120 kg N',
      tone: 'better',
    })
  })

  it('shows more N load as worse', () => {
    expect(describeNLoadDelta(1_035, 1_000)).toEqual({
      text: '+35 kg N',
      tone: 'worse',
    })
  })

  it('treats a difference below one kilogram as the same', () => {
    expect(describeNLoadDelta(1_000.3, 1_000)).toEqual({
      text: '±0 kg N',
      tone: 'same',
    })
  })
})

describe('describeFieldChanges', () => {
  it('counts the changed fields and leaves out locks when there are none', () => {
    expect(
      describeFieldChanges({ changed: 25, locked: 0, uncalculated: 0 }),
    ).toBe('25 marker ændret')
  })

  it('adds the locked fields', () => {
    expect(
      describeFieldChanges({ changed: 25, locked: 2, uncalculated: 0 }),
    ).toBe('25 marker ændret · 2 marker låst')
  })

  it('says so when no field is changed', () => {
    expect(
      describeFieldChanges({ changed: 0, locked: 1, uncalculated: 0 }),
    ).toBe('Ingen marker ændret · 1 mark låst')
  })

  it('adds the fields that are not calculated', () => {
    expect(
      describeFieldChanges({ changed: 1, locked: 0, uncalculated: 3 }),
    ).toBe('1 mark ændret · 3 marker er ikke beregnet')
  })
})
