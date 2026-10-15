import { describe, expect, it } from 'vitest'

import {
  RULES_PANEL_WIDTH,
  resolveListPaneWidth,
  splitPaneSpace,
} from '@/components/farm/split-layout'

describe('resolveListPaneWidth', () => {
  it('does not let a narrower saved width go below the minimum', () => {
    expect(resolveListPaneWidth(RULES_PANEL_WIDTH, -0.3, 1800)).toBe(502)
    expect(
      resolveListPaneWidth(RULES_PANEL_WIDTH, -0.3, 1800, RULES_PANEL_WIDTH),
    ).toBe(RULES_PANEL_WIDTH)
  })

  it('gives the minimum room before the map, but never more than there is', () => {
    expect(resolveListPaneWidth(RULES_PANEL_WIDTH, 0, 1300)).toBe(932)
    expect(
      resolveListPaneWidth(RULES_PANEL_WIDTH, 0, 1300, RULES_PANEL_WIDTH),
    ).toBe(RULES_PANEL_WIDTH)
    expect(
      resolveListPaneWidth(RULES_PANEL_WIDTH, 0, 1000, RULES_PANEL_WIDTH),
    ).toBe(splitPaneSpace(1000))
  })
})
