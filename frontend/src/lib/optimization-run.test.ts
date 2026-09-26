import { describe, expect, it } from 'vitest'

import { optimizationFailureMessage } from '@/lib/optimization-run'

describe('optimizationFailureMessage', () => {
  it('replaces the out-of-time message with one the user can act on', () => {
    const message = optimizationFailureMessage(
      { status: 503, message: 'prøv en længere tidsgrænse.' },
      600,
    )
    expect(message).toContain('inden for 10 minutter')
    expect(message).not.toContain('tidsgrænse')
  })

  it('keeps the backend message for other failures', () => {
    const message = 'Ingen sædskifte-fordeling kan opfylde de gemte krav'
    expect(optimizationFailureMessage({ status: 422, message }, 600)).toBe(
      message,
    )
    expect(optimizationFailureMessage({ message }, 600)).toBe(message)
  })
})
