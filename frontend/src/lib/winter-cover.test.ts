import { describe, expect, it } from 'vitest'

import type { RotationYear } from '@/api/types'
import {
  BARE_SOIL,
  CATCH_CROP,
  EARLY_SOWING,
  INTERMEDIATE_CROP,
  INTERMEDIATE_OR_EARLY_SOWING,
  STUBBLE,
  isIntermediateOrEarlySowingYear,
  measureCover,
  rotationCovers,
  yearCoversFromDetail,
} from '@/lib/winter-cover'

describe('measureCover', () => {
  it('gives the cover of a chosen vinterdække or virkemiddel', () => {
    expect(measureCover(951)).toBe(CATCH_CROP)
    expect(measureCover(922)).toBe(STUBBLE)
    expect(measureCover(921)).toBe(BARE_SOIL)
    expect(measureCover(1)).toBeNull()
  })
})

const coversOf = (detail: Record<string, unknown>) =>
  yearCoversFromDetail(detail).map(({ cover }) => cover)

describe('yearCoversFromDetail', () => {
  it('shows a history year inferred as an intermediate crop as either measure', () => {
    expect(
      coversOf({ W: 4, EMA: 0.2, intermediateOrEarlySowing: true }),
    ).toEqual([INTERMEDIATE_OR_EARLY_SOWING])
  })

  it('shows a history year inferred as early sowing as either measure', () => {
    expect(
      coversOf({ W: 1, ETS: 0.2, intermediateOrEarlySowing: true }),
    ).toEqual([INTERMEDIATE_OR_EARLY_SOWING])
  })

  it('keeps a chosen intermediate crop and early sowing apart', () => {
    expect(coversOf({ W: 4, EMA: 0.2 })).toEqual([INTERMEDIATE_CROP])
    expect(coversOf({ W: 1, ETS: 0.2 }).at(-1)).toBe(EARLY_SOWING)
  })
})

describe('rotationCovers', () => {
  it('shows a history year named as either measure as either, from the year alone', () => {
    const covers = rotationCovers([
      {
        cropCode: 1,
        cropName: 'Vårbyg',
        undersownCropCode: 9682,
        undersownCropName: 'Mellemafgrøde/tidlig såning',
      },
      {
        cropCode: 1,
        cropName: 'Vårbyg',
        undersownCropCode: 9682,
        undersownCropName: 'Mellemafgrøde',
      },
    ] as RotationYear[])
    expect(covers?.map((year) => year.map(({ cover }) => cover))).toEqual([
      [INTERMEDIATE_OR_EARLY_SOWING],
      [INTERMEDIATE_CROP],
    ])
  })
})

describe('isIntermediateOrEarlySowingYear', () => {
  it('recognises a history year named as either measure, not a chosen one', () => {
    const year = (undersownCropName: string | null) =>
      ({
        cropCode: 1,
        cropName: 'Vårbyg',
        undersownCropCode: 9682,
        undersownCropName,
      }) as RotationYear
    expect(
      isIntermediateOrEarlySowingYear(year('Mellemafgrøde/tidlig såning')),
    ).toBe(true)
    expect(isIntermediateOrEarlySowingYear(year('Mellemafgrøde'))).toBe(false)
  })
})
