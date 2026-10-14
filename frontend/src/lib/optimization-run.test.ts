import { describe, expect, it } from 'vitest'

import {
  optimizationFailureMessage,
  optimizationRunName,
} from '@/lib/optimization-run'

describe('optimizationFailureMessage', () => {
  it('replaces the out-of-time message with one the user can act on', () => {
    const message = optimizationFailureMessage({
      status: 503,
      message: 'prøv en længere tidsgrænse.',
    })
    expect(message).toContain('inden for tidsgrænsen')
    expect(message).toContain('Prøv at lempe reglerne')
    expect(message).not.toContain('længere tidsgrænse')
    expect(message).not.toContain('90 sekunder')
  })

  it('keeps the backend message for other failures', () => {
    const message = 'Ingen sædskifte-fordeling kan opfylde de gemte krav'
    expect(optimizationFailureMessage({ status: 422, message })).toBe(message)
    expect(optimizationFailureMessage({ message })).toBe(message)
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
