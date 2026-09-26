import { describe, expect, it } from 'vitest'

import {
  moveOverviewBoundary,
  OVERVIEW_DEFAULT_FRACTIONS,
  OVERVIEW_MIN_CARD_WIDTHS,
  overviewCardSpace,
  overviewCardsFit,
  overviewDividerPosition,
  parseOverviewFractions,
  resolveOverviewCardWidths,
} from '@/components/farm/overview-layout'

const defaults = OVERVIEW_DEFAULT_FRACTIONS.threeCards
const mins = OVERVIEW_MIN_CARD_WIDTHS.threeCards
const total = (widths: number[]) => widths.reduce((sum, width) => sum + width)

describe('overviewCardsFit', () => {
  it('fits when the row holds every minimum plus the dividers', () => {
    const needed = total(mins) + 2 * 12
    expect(overviewCardsFit(needed, mins)).toBe(true)
    expect(overviewCardsFit(needed - 1, mins)).toBe(false)
  })
})

describe('resolveOverviewCardWidths', () => {
  it('splits the space by the fractions when every card has room', () => {
    expect(resolveOverviewCardWidths(defaults, mins, 1200)).toEqual([
      540, 300, 360,
    ])
  })

  it('lifts a card to its minimum and takes the room from the others', () => {
    const widths = resolveOverviewCardWidths([0.6, 0.1, 0.3], mins, 1000)
    expect(widths[1]).toBe(256)
    expect(total(widths)).toBeCloseTo(1000)
    widths.forEach((width, index) =>
      expect(width).toBeGreaterThanOrEqual(mins[index]),
    )
  })

  it('gives every card its minimum when the row is exactly wide enough', () => {
    const space = overviewCardSpace(total(mins) + 24, 3)
    const widths = resolveOverviewCardWidths(defaults, mins, space)
    widths.forEach((width, index) => expect(width).toBeCloseTo(mins[index]))
  })
})

describe('moveOverviewBoundary', () => {
  const widths = [540, 300, 360]

  it('only resizes the two cards next to the divider', () => {
    expect(moveOverviewBoundary(widths, mins, defaults, 0, 482)).toEqual([
      480, 360, 360,
    ])
  })

  it('snaps back to the default boundary', () => {
    expect(moveOverviewBoundary(widths, mins, defaults, 0, 527)).toEqual(
      widths,
    )
  })

  it('stops the right-hand card at its minimum', () => {
    expect(moveOverviewBoundary(widths, mins, defaults, 0, 700)).toEqual([
      584, 256, 360,
    ])
  })

  it('accounts for the dividers before the moved one', () => {
    expect(moveOverviewBoundary(widths, mins, defaults, 1, 794)).toEqual([
      540, 260, 400,
    ])
  })

  it('places the divider where overviewDividerPosition reports it', () => {
    const position = overviewDividerPosition(widths, 1)
    expect(moveOverviewBoundary(widths, mins, defaults, 1, position)).toEqual(
      widths,
    )
  })
})

describe('parseOverviewFractions', () => {
  it('falls back to the default for missing or malformed values', () => {
    expect(parseOverviewFractions(null, 'threeCards')).toBe(defaults)
    expect(parseOverviewFractions('not json', 'threeCards')).toBe(defaults)
    expect(parseOverviewFractions('[0.5, 0.5]', 'threeCards')).toBe(defaults)
    expect(parseOverviewFractions('[0.5, -0.2, 0.7]', 'threeCards')).toBe(
      defaults,
    )
  })

  it('normalises stored fractions to sum to one', () => {
    expect(parseOverviewFractions('[2, 1, 1]', 'threeCards')).toEqual([
      0.5, 0.25, 0.25,
    ])
  })
})
