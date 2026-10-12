import { describe, expect, it } from 'vitest'

import {
  describeFarmAccess,
  describeLeaveFarm,
  otherMemberEmails,
} from '@/lib/farm-access'

const members = [
  { email: 'Anders.Bak@example.com' },
  { email: 'karen.holm@example.com' },
]

describe('otherMemberEmails', () => {
  it('leaves out the signed-in user whatever the casing', () => {
    expect(otherMemberEmails(members, 'anders.bak@example.com')).toEqual([
      'karen.holm@example.com',
    ])
  })
})

describe('describeFarmAccess', () => {
  it('says who the farm is shared with', () => {
    expect(describeFarmAccess([])).toBe('Kun dig')
    expect(describeFarmAccess(['karen.holm@example.com'])).toBe(
      'Delt med karen.holm@example.com',
    )
    expect(describeFarmAccess(['a@example.com', 'b@example.com'])).toBe(
      'Delt med 2 andre',
    )
  })
})

describe('describeLeaveFarm', () => {
  it('says who can share the farm again', () => {
    expect(describeLeaveFarm(['karen.holm@example.com'])).toBe(
      'Du mister adgangen til bedriften. karen.holm@example.com kan dele den med dig igen.',
    )
    expect(describeLeaveFarm(['a@example.com', 'b@example.com'])).toBe(
      'Du mister adgangen til bedriften. De andre med adgang kan dele den med dig igen.',
    )
  })
})
