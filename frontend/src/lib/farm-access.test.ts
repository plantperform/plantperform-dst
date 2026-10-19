import { describe, expect, it } from 'vitest'

import {
  describeFarmAccess,
  describeLeaveFarm,
  describeLeaveProfile,
  describeShareFarm,
  memberProfileNames,
  memberProfilesLabel,
  otherMemberEmails,
  shareEmailError,
} from '@/lib/farm-access'

const members = [
  { email: 'Anders.Bak@example.com' },
  { email: 'karen.holm@example.com' },
]

describe('shareEmailError', () => {
  it('wants an address that does not have access yet', () => {
    expect(shareEmailError('', members)).toBe('Skriv en e-mailadresse.')
    expect(shareEmailError('karen.holm', members)).toBe(
      'Skriv en e-mailadresse.',
    )
    expect(shareEmailError('karen.holm@example.com', members)).toBe(
      'Har allerede adgang.',
    )
    expect(shareEmailError('ny@example.com', members)).toBeNull()
  })
})

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

describe('describeLeaveProfile', () => {
  it('says what happens to the simulations and who can share the profile again', () => {
    expect(describeLeaveProfile(['karen.holm@example.com'])).toBe(
      'Du mister adgangen til profilen. Simuleringer, der bruger den, beholder deres tal, men du kan ikke genberegne dem med den. karen.holm@example.com kan dele den med dig igen.',
    )
    expect(describeLeaveProfile(['a@example.com', 'b@example.com'])).toBe(
      'Du mister adgangen til profilen. Simuleringer, der bruger den, beholder deres tal, men du kan ikke genberegne dem med den. De andre med adgang kan dele den med dig igen.',
    )
  })
})

describe('memberProfileNames', () => {
  const profiles = [
    { name: 'Højere hvedepris', members },
    { name: 'Dyrere diesel', members: [{ email: 'karen.holm@example.com' }] },
  ]

  it('lists the profiles the member also has whatever the casing', () => {
    expect(memberProfileNames('anders.bak@example.com', profiles)).toEqual([
      'Højere hvedepris',
    ])
    expect(memberProfileNames('karen.holm@example.com', profiles)).toEqual([
      'Højere hvedepris',
      'Dyrere diesel',
    ])
    expect(memberProfileNames('ny@example.com', profiles)).toEqual([])
  })
})

describe('memberProfilesLabel', () => {
  it('introduces one or more profiles', () => {
    expect(memberProfilesLabel(1)).toBe('Har også økonomiprofilen:')
    expect(memberProfilesLabel(2)).toBe('Har også økonomiprofilerne:')
  })
})

describe('describeShareFarm', () => {
  it('warns that the new member gets the same control', () => {
    expect(describeShareFarm('karen.holm@example.com')).toBe(
      'karen.holm@example.com får samme adgang som dig og kan ændre marker og simuleringer, dele bedriften med andre, fjerne andres adgang og slette bedriften.',
    )
  })
})
