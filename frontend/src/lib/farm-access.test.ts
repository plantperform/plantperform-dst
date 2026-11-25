import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import type { FarmMember } from '@/api/types'
import {
  canLeave,
  describeFarmAccess,
  describeLeaveFarm,
  describeLeaveProfile,
  describeShareFarm,
  farmCreator,
  memberProfileNames,
  memberProfilesLabel,
  notShared,
  otherMemberEmails,
  ownRole,
  shareEmailError,
} from '@/lib/farm-access'

const members: FarmMember[] = [
  { email: 'Anders.Bak@example.com', role: 'editor' },
  { email: 'karen.holm@example.com', role: 'viewer' },
]

describe('notShared', () => {
  it('counts an existing member as shared and keeps what failed', () => {
    expect(
      notShared(
        ['delt', 'havde adgang', 'fejlede'],
        [
          { status: 'fulfilled', value: null },
          { status: 'rejected', reason: new ApiError(409, 'Har adgang') },
          { status: 'rejected', reason: new ApiError(404, 'Ikke fundet') },
        ],
      ),
    ).toEqual(['fejlede'])
  })
})

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
    {
      name: 'Dyrere diesel',
      members: [{ email: 'karen.holm@example.com', role: 'editor' as const }],
    },
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

describe('farmCreator', () => {
  it('finds the creator and is null without one', () => {
    const withCreator: FarmMember[] = [
      { email: 'Anders.Bak@example.com', role: 'editor', creator: true },
      { email: 'karen.holm@example.com', role: 'editor' },
    ]
    expect(farmCreator(withCreator)).toBe('Anders.Bak@example.com')
    expect(farmCreator(members)).toBeNull()
  })
})

describe('describeShareFarm', () => {
  it('says an editor cannot remove the creator or delete the farm', () => {
    expect(describeShareFarm('karen.holm@example.com', 'editor', 'dig')).toBe(
      'karen.holm@example.com kan ændre marker og simuleringer, dele bedriften med andre og fjerne andres adgang, men ikke fjerne dig eller slette bedriften.',
    )
  })

  it('warns that an editor gets the same control and a viewer only looks', () => {
    expect(describeShareFarm('karen.holm@example.com', 'editor', null)).toBe(
      'karen.holm@example.com får samme adgang som dig og kan ændre marker og simuleringer, dele bedriften med andre, fjerne andres adgang og slette bedriften.',
    )
    expect(describeShareFarm('karen.holm@example.com', 'viewer', null)).toBe(
      'karen.holm@example.com kan se bedriftens marker og simuleringer og lave en kopi af bedriften, men ikke ændre noget.',
    )
  })
})

describe('ownRole and canLeave', () => {
  it('finds the role whatever the casing and lets a viewer leave', () => {
    expect(ownRole(members, 'anders.bak@example.com')).toBe('editor')
    expect(ownRole(members, 'ny@example.com')).toBeNull()
    expect(canLeave(members, 'karen.holm@example.com')).toBe(true)
  })

  it('keeps the last editor and anyone without an explicit membership', () => {
    expect(canLeave(members, 'anders.bak@example.com')).toBe(false)
    expect(
      canLeave(
        [...members, { email: 'ole@example.com', role: 'editor' }],
        'anders.bak@example.com',
      ),
    ).toBe(true)
    expect(canLeave(members, 'ny@example.com')).toBe(false)
  })
})
