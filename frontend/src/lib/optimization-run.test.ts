import { describe, expect, it } from 'vitest'

import {
  optimizationRunName,
  optimizationStatusLabel,
} from '@/lib/optimization-run'

describe('optimizationStatusLabel', () => {
  it('rounds a time-limited plan’s gap upward in Danish', () => {
    const label = optimizationStatusLabel({ status: 'FEASIBLE', optimalityGapPct: 2.31 })

    expect(label).toContain('højst 2,4 %')
  })

  it('shows the measured gap for an early success', () => {
    const label = optimizationStatusLabel({ status: 'OPTIMAL', optimalityGapPct: 0.15 })

    expect(label).toContain('højst 0,2 %')
  })

  it('keeps the original status text for a saved plan without a gap', () => {
    const label = optimizationStatusLabel({ status: 'FEASIBLE' })

    expect(label).toBe('brugbar løsning, tidsgrænsen blev nået')
  })
})

describe('optimizationRunName', () => {
  it('names the run after the type chosen in the dialog', () => {
    expect(optimizationRunName('optimize')).toBe(
      'Optimering (gennemsnit for perioden)',
    )
    expect(optimizationRunName('yearly')).toBe('Optimering (loft hvert år)')
  })
})
