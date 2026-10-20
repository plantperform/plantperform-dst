import { describe, expect, it } from 'vitest'

import { colorLegendLabel, COLOR_SPECS } from '@/lib/map-coloring'

describe('colorLegendLabel', () => {
  it('names the selected year on Udvaskning and Udledning', () => {
    expect(colorLegendLabel(COLOR_SPECS.leaching, 'leaching', 2023)).toBe(
      'Udvaskning 2023',
    )
    expect(colorLegendLabel(COLOR_SPECS.nLoad, 'nLoad', 2030)).toBe(
      'Udledning 2030',
    )
  })

  it('keeps the label without a selected year', () => {
    expect(colorLegendLabel(COLOR_SPECS.nLoad, 'nLoad', null)).toBe('Udledning')
  })

  it('keeps the label of a scheme that does not follow the year', () => {
    expect(colorLegendLabel(COLOR_SPECS.db2, 'db2', 2023)).toBe(
      COLOR_SPECS.db2.label,
    )
  })
})
