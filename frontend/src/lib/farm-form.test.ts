import { describe, expect, it } from 'vitest'

import { farmLookupErrors, formatCvr, toCvrDigits } from '@/lib/farm-form'

describe('CVR', () => {
  it('keeps at most eight digits of what is typed', () => {
    expect(toCvrDigits('12 34-56 789')).toBe('12345678')
  })

  it('shows the digits in pairs', () => {
    expect(formatCvr('12345678')).toBe('12 34 56 78')
    expect(formatCvr('123')).toBe('12 3')
  })
})

describe('farmLookupErrors', () => {
  it('needs all eight digits before the markregister can be searched', () => {
    expect(farmLookupErrors('Bakkegården', 'Anders Bak', '1234567').cvr).toBe(
      'Skriv de 8 cifre i CVR-nummeret.',
    )
    expect(farmLookupErrors('Bakkegården', 'Anders Bak', '12345678')).toEqual(
      {},
    )
  })

  it('still asks for the navn and the ejer', () => {
    expect(Object.keys(farmLookupErrors('', '', '12345678'))).toEqual([
      'name',
      'ownerName',
    ])
  })
})
