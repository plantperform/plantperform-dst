import { describe, expect, it } from 'vitest'

import type { RotationYear } from '@/api/types'
import {
  cropLabel,
  cropLabelByCode,
  cropLabelByName,
  rotationYearLabel,
} from '@/lib/crop-label'

const year = (overrides: Partial<RotationYear> = {}): RotationYear => ({
  cropCode: 210,
  cropName: 'Vårbyg, helsæd',
  undersownCropCode: null,
  undersownCropName: null,
  ...overrides,
})

describe('cropLabel', () => {
  it('puts the afgrødekode in front of the full name', () => {
    expect(cropLabel(210, 'Vårbyg, helsæd')).toBe('210 - Vårbyg, helsæd')
  })

  it('keeps names that already contain dashes or parentheses intact', () => {
    expect(cropLabel(151, 'Kartofler, stivelses-')).toBe(
      '151 - Kartofler, stivelses-',
    )
    expect(cropLabel(251, 'Permanent græs (maks. 50 % kløver)')).toBe(
      '251 - Permanent græs (maks. 50 % kløver)',
    )
  })

  it('shows the name alone when the code is unknown', () => {
    expect(cropLabel(null, 'Vårbyg')).toBe('Vårbyg')
    expect(cropLabel(undefined, 'Vårbyg')).toBe('Vårbyg')
    expect(cropLabel(0, 'Vårbyg')).toBe('Vårbyg')
  })
})

const cropCodes = [
  { code: 11, name: 'Vinterhvede' },
  { code: 210, name: 'Vårbyg, helsæd' },
]

describe('cropLabelByCode', () => {
  it('looks the full name up by the afgrødekode', () => {
    expect(cropLabelByCode(210, cropCodes)).toBe('210 - Vårbyg, helsæd')
  })

  it('names a code that has no crop name', () => {
    expect(cropLabelByCode(999, cropCodes)).toBe('Afgrøde 999')
    expect(cropLabelByCode(11, [])).toBe('Afgrøde 11')
  })
})

describe('cropLabelByName', () => {
  it('looks the afgrødekode up by the full name', () => {
    expect(cropLabelByName('Vårbyg, helsæd', cropCodes)).toBe(
      '210 - Vårbyg, helsæd',
    )
  })

  it('shows a name without a matching afgrødekode alone', () => {
    expect(cropLabelByName('Havre', cropCodes)).toBe('Havre')
    expect(cropLabelByName('Vinterhvede', [])).toBe('Vinterhvede')
  })
})

describe('rotationYearLabel', () => {
  it('labels a year without an undersown crop by its crop alone', () => {
    expect(rotationYearLabel(year())).toBe('210 - Vårbyg, helsæd')
  })

  it('adds the undersown crop, with its own code, in parentheses', () => {
    expect(
      rotationYearLabel(
        year({ undersownCropCode: 301, undersownCropName: 'Græsudlæg' }),
      ),
    ).toBe('210 - Vårbyg, helsæd (301 - Græsudlæg)')
  })

  it('leaves out the code of an undersown crop that has none', () => {
    expect(rotationYearLabel(year({ undersownCropName: 'Græsudlæg' }))).toBe(
      '210 - Vårbyg, helsæd (Græsudlæg)',
    )
  })
})
