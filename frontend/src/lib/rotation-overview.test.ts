import { describe, expect, it } from 'vitest'

import type {
  FieldRecord,
  RotationCategoryOption,
  RotationOption,
} from '@/api/types'
import { emptyMeasures } from '@/lib/field-domain'
import {
  cropSequenceOf,
  cropSequenceText,
  libraryRotationNumber,
  NO_ROTATION_COLOR,
  rotationColorsOf,
  rotationKey,
  rotationLabel,
  rotationNamesOf,
  rotationOptionsOf,
  rotationVariantOf,
  summarizeRotationDistribution,
  type RotationShare,
} from '@/lib/rotation-overview'

const field = (overrides: Partial<FieldRecord>): FieldRecord => ({
  id: 'field',
  farmId: 'farm',
  imkId: null,
  catchmentId: 7,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId: '315:4:80',
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 0,
  nLoad: 0,
  leaching: 0,
  feedUnits: 0,
  name: 'field',
  areaHa: 1,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
  ...overrides,
})

const rotations: RotationOption[] = [
  {
    rotationVariant: '315',
    cropSequence: ['Vinterhvede', 'Vårbyg'],
    activeLen: 2,
  },
  { rotationVariant: '42', cropSequence: ['Raps', 'Vinterbyg'], activeLen: 2 },
]

describe('rotationVariantOf', () => {
  it('takes the part before the first colon', () => {
    expect(rotationVariantOf('315:4:80')).toBe('315')
  })

  it('keeps an id without colons whole', () => {
    expect(rotationVariantOf('current')).toBe('current')
  })
})

describe('rotationLabel', () => {
  it('names a rotation by its number', () => {
    expect(rotationLabel('315')).toBe('Sædskifte 315')
  })

  it('names the permanent crops and the fields without a rotation', () => {
    expect(rotationLabel('permanent')).toBe('Permanente sædskifter')
    expect(rotationLabel(null)).toBe('Uden sædskifte')
  })
})

describe('libraryRotationNumber', () => {
  it('numbers the library rotations but not an own rotation, whose id is not a number', () => {
    expect(libraryRotationNumber('22')).toBe('22')
    expect(
      libraryRotationNumber('3f2a8c1e-5b7d-4e2a-9c1f-0a2b3c4d5e6f'),
    ).toBeNull()
  })
})

describe('rotationKey', () => {
  it('keeps the rotation and gives the fields without one their own key', () => {
    expect(rotationKey('315')).toBe('315')
    expect(rotationKey(null)).toBe('none')
  })
})

describe('cropSequenceText', () => {
  it('numbers the crops in the order of the years', () => {
    expect(cropSequenceText(['Vinterhvede', 'Vårbyg'])).toBe(
      '1. Vinterhvede → 2. Vårbyg',
    )
  })

  it('numbers a crop that comes back once for each year', () => {
    expect(cropSequenceText(['Vårbyg', 'Raps', 'Vårbyg'])).toBe(
      '1. Vårbyg → 2. Raps → 3. Vårbyg',
    )
  })

  it('is empty for a rotation without crops', () => {
    expect(cropSequenceText([])).toBe('')
  })
})

describe('cropSequenceOf', () => {
  const shares = summarizeRotationDistribution(
    [
      field({ id: 'a', rotationId: '315:4:80' }),
      field({ id: 'b', rotationId: '999:1:80' }),
      field({ id: 'c', rotationId: null }),
    ],
    rotations,
  )

  it('gives the crops of the rotation a field follows, whichever candidate it is', () => {
    expect(cropSequenceOf('315:4:80', shares)).toEqual([
      'Vinterhvede',
      'Vårbyg',
    ])
    expect(cropSequenceOf('315:7:100', shares)).toEqual([
      'Vinterhvede',
      'Vårbyg',
    ])
  })

  it('has none for a field without a rotation', () => {
    expect(cropSequenceOf(null, shares)).toBeNull()
  })

  it('has none for a rotation missing from the options', () => {
    expect(cropSequenceOf('999:1:80', shares)).toBeNull()
  })

  it('has none for a rotation that no field of the farm follows', () => {
    expect(cropSequenceOf('42:1:90', shares)).toBeNull()
  })
})

describe('rotationColorsOf', () => {
  const sharesOf = (variants: (string | null)[]): RotationShare[] =>
    variants.map((rotationVariant) => ({
      rotationVariant,
      name: null,
      cropSequence: null,
      areaHa: 1,
      share: 1 / variants.length,
      fieldCount: 1,
    }))

  it('hands out the colours in the order of the shares', () => {
    const colors = rotationColorsOf(sharesOf(['315', '42', '7']))
    expect(new Set(colors.values()).size).toBe(3)
    expect([...colors.keys()]).toEqual(['315', '42', '7'])
  })

  it('gives the fields without a rotation the grey and uses up no colour', () => {
    const withGap = rotationColorsOf(sharesOf(['315', null, '42']))
    const without = rotationColorsOf(sharesOf(['315', '42']))
    expect(withGap.get('none')).toBe(NO_ROTATION_COLOR)
    expect(withGap.get('42')).toBe(without.get('42'))
  })

  it('starts the colours over when there are more rotations than colours', () => {
    const variants = Array.from({ length: 12 }, (_, index) => `${index + 1}`)
    const colors = rotationColorsOf(sharesOf(variants))
    expect(colors.get('11')).toBe(colors.get('1'))
    expect(colors.get('12')).toBe(colors.get('2'))
    expect(colors.get('2')).not.toBe(colors.get('1'))
  })

  it('colours the rotations of the whole farm the same in any scope', () => {
    const farm = [
      field({ id: 'a', rotationId: '315:4:80', areaHa: 5 }),
      field({ id: 'b', rotationId: '42:1:100', areaHa: 3 }),
      field({ id: 'c', rotationId: null, areaHa: 1 }),
    ]
    const colors = rotationColorsOf(
      summarizeRotationDistribution(farm, rotations),
    )
    const scoped = summarizeRotationDistribution([farm[1]], rotations)
    expect(
      scoped.map((share) => colors.get(rotationKey(share.rotationVariant))),
    ).toEqual([colors.get('42')])
    expect(colors.get('42')).not.toBe(colors.get('315'))
  })
})

describe('rotationOptionsOf', () => {
  it('lists a rotation once even when several categories hold it', () => {
    const category = (
      name: string,
      options: RotationOption[],
    ): RotationCategoryOption => ({
      category: name,
      croppingSystem: 'Konventionel',
      rotationCount: options.length,
      rotations: options,
    })

    const options = rotationOptionsOf([
      category('A', [rotations[0]]),
      category('B', rotations),
    ])

    expect(options.map((option) => option.rotationVariant)).toEqual([
      '315',
      '42',
    ])
  })
})

describe('rotationNamesOf', () => {
  it('names an own sædskifte from the simulation when the list no longer has it', () => {
    const names = rotationNamesOf(
      [
        {
          rotationVariant: 'own-1',
          name: 'Nyt navn',
          cropSequence: ['Raps'],
          activeLen: 1,
        },
      ],
      [
        undefined,
        { 'own-1': { name: 'Gammelt navn' }, 'own-2': { name: 'Slettet' } },
      ],
    )
    expect(names.get('own-1')).toBe('Nyt navn')
    expect(names.get('own-2')).toBe('Slettet')
  })
})

describe('summarizeRotationDistribution', () => {
  it('merges candidates of the same rotation into one row', () => {
    const shares = summarizeRotationDistribution(
      [
        field({ id: 'a', areaHa: 2, rotationId: '315:4:80' }),
        field({ id: 'b', areaHa: 3, rotationId: '315:7:100' }),
        field({ id: 'c', areaHa: 5, rotationId: '42:1:90' }),
      ],
      rotations,
    )

    expect(shares.map((entry) => entry.rotationVariant)).toEqual(['42', '315'])
    expect(shares[1]).toMatchObject({ areaHa: 5, share: 0.5, fieldCount: 2 })
    expect(shares[1].cropSequence).toEqual(['Vinterhvede', 'Vårbyg'])
  })

  it('puts fields without a rotation last so the shares sum to one', () => {
    const shares = summarizeRotationDistribution(
      [
        field({ id: 'a', areaHa: 1, rotationId: '315:4:80' }),
        field({ id: 'b', areaHa: 9, rotationId: null }),
      ],
      rotations,
    )

    expect(shares.map((entry) => entry.rotationVariant)).toEqual(['315', null])
    expect(shares[1]).toMatchObject({ share: 0.9, cropSequence: null })
    expect(shares.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1)
  })

  it('sorts by area, largest first, and breaks ties by rotation number', () => {
    const shares = summarizeRotationDistribution(
      [
        field({ id: 'a', areaHa: 4, rotationId: '315:1:80' }),
        field({ id: 'b', areaHa: 4, rotationId: '42:1:80' }),
        field({ id: 'c', areaHa: 6, rotationId: '9:1:80' }),
      ],
      [],
    )

    expect(shares.map((entry) => entry.rotationVariant)).toEqual([
      '9',
      '42',
      '315',
    ])
  })

  it('gives every row a share of zero when the total area is zero', () => {
    const shares = summarizeRotationDistribution(
      [
        field({ id: 'a', areaHa: 0, rotationId: '315:4:80' }),
        field({ id: 'b', areaHa: 0, rotationId: null }),
      ],
      rotations,
    )

    expect(shares.map((entry) => entry.share)).toEqual([0, 0])
    expect(shares.map((entry) => entry.fieldCount)).toEqual([1, 1])
  })

  it('has no crop sequence for a rotation missing from the options', () => {
    const [share] = summarizeRotationDistribution(
      [field({ rotationId: '999:1:80' })],
      rotations,
    )

    expect(share.cropSequence).toBeNull()
  })

  it('returns no rows without fields', () => {
    expect(summarizeRotationDistribution([], rotations)).toEqual([])
  })
})

describe('own rotation names', () => {
  it('shows an own rotation by its name instead of its id', () => {
    const [share] = summarizeRotationDistribution(
      [field({ rotationId: 'b1f2:v3~0-951:100' })],
      [
        {
          rotationVariant: 'b1f2',
          cropSequence: ['Vinterhvede'],
          activeLen: 1,
          name: 'Korn og raps',
        },
      ],
    )
    expect(share.name).toBe('Korn og raps')
    expect(rotationLabel(share.rotationVariant, share.name)).toBe(
      'Korn og raps',
    )
    expect(rotationLabel('315')).toBe('Sædskifte 315')
  })
})
