import { describe, expect, it } from 'vitest'

import {
  formatFullName,
  normalizeUserName,
  parseStoredUserName,
  userInitials,
  validateUserName,
  welcomeGreeting,
} from '@/lib/user-name'

const anders = { firstName: 'Anders', lastName: 'Bak' }

describe('validateUserName', () => {
  it('asks for both a first and a last name', () => {
    expect(validateUserName(anders)).toBeNull()
    expect(validateUserName({ firstName: 'Anders', lastName: ' ' })).toBe(
      'Skriv både fornavn og efternavn.',
    )
    expect(validateUserName({ firstName: '', lastName: 'Bak' })).toBe(
      'Skriv både fornavn og efternavn.',
    )
  })
})

describe('normalizeUserName', () => {
  it('trims the spaces around each name', () => {
    expect(
      normalizeUserName({ firstName: ' Anne Marie ', lastName: ' Holm' }),
    ).toEqual({ firstName: 'Anne Marie', lastName: 'Holm' })
  })
})

describe('formatFullName', () => {
  it('writes the first name before the last name', () => {
    expect(formatFullName(anders)).toBe('Anders Bak')
    expect(formatFullName({ firstName: 'Anders', lastName: '' })).toBe('Anders')
    expect(formatFullName({ firstName: '', lastName: '' })).toBe('')
  })
})

describe('userInitials', () => {
  it('takes the first letter of the first and the last name', () => {
    expect(userInitials(anders, 'anders.bak@example.com')).toBe('AB')
    expect(
      userInitials(
        { firstName: 'anne marie', lastName: 'holm' },
        'am@example.com',
      ),
    ).toBe('AH')
  })

  it('falls back to the first letter of the e-mail', () => {
    expect(userInitials(null, 'karen.holm@example.com')).toBe('K')
  })
})

describe('welcomeGreeting', () => {
  it('greets by first name when the user has given one', () => {
    expect(welcomeGreeting(anders)).toBe('Velkommen, Anders')
    expect(welcomeGreeting(null)).toBe('Velkommen')
  })
})

describe('parseStoredUserName', () => {
  it('reads a stored name', () => {
    expect(parseStoredUserName(JSON.stringify(anders))).toEqual(anders)
  })

  it('ignores a missing, broken or incomplete value', () => {
    expect(parseStoredUserName(null)).toBeNull()
    expect(parseStoredUserName('Anders Bak')).toBeNull()
    expect(parseStoredUserName('"Anders Bak"')).toBeNull()
    expect(
      parseStoredUserName(JSON.stringify({ firstName: 'Anders' })),
    ).toBeNull()
    expect(
      parseStoredUserName(
        JSON.stringify({ firstName: 'Anders', lastName: ' ' }),
      ),
    ).toBeNull()
  })
})
