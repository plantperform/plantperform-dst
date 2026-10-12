import { describe, expect, it } from 'vitest'

import type { Farm } from '@/api/types'
import { switcherFarms } from '@/lib/farm-switcher'

const farm = (id: string, name: string, ownerName = 'Anders Bak'): Farm => ({
  id,
  name,
  ownerName,
  cvr: null,
  rotationLibrary: [],
})

const FEW = [
  farm('a', 'Bakkegården'),
  farm('b', 'Enghavegård'),
  farm('c', 'Højgård'),
]

const MANY = Array.from({ length: 9 }, (_, index) =>
  farm(`f${index}`, `Gård ${index}`, index === 7 ? 'Lene Holm' : 'Anders Bak'),
)

describe('switcherFarms', () => {
  it('lists a few farms with the last opened first', () => {
    const list = switcherFarms(FEW, { c: 300, a: 200 }, '')

    expect(list.searchable).toBe(false)
    expect(list.heading).toBe('Bedrifter')
    expect(list.farms.map((entry) => entry.id)).toEqual(['c', 'a', 'b'])
  })

  it('shows only the six last opened when there are many farms', () => {
    const list = switcherFarms(MANY, { f8: 900, f3: 800 }, '')

    expect(list.searchable).toBe(true)
    expect(list.heading).toBe('Sidst åbnet')
    expect(list.farms.map((entry) => entry.id)).toEqual([
      'f8',
      'f3',
      'f0',
      'f1',
      'f2',
      'f4',
    ])
  })

  it('searches all the farms by name and owner', () => {
    const list = switcherFarms(MANY, {}, 'lene')

    expect(list.heading).toBe('Bedrifter')
    expect(list.farms.map((entry) => entry.id)).toEqual(['f7'])
  })
})
