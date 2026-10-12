import { describe, expect, it } from 'vitest'

import { describeLanding } from '@/lib/onboarding'

describe('describeLanding', () => {
  it('says where the user lands after login', () => {
    expect(describeLanding('farmer')).toBe(
      'Bedriften åbner direkte, når du kun har en. Ellers lander du på Dine bedrifter.',
    )
    expect(describeLanding(null)).toBe(describeLanding('farmer'))
    expect(describeLanding('advisor')).toBe('Du lander på Dine bedrifter.')
  })
})
