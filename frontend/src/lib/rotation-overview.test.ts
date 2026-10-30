import { describe, expect, it } from 'vitest'

import type {
  FieldRecord,
  RotationCategoryOption,
  RotationOption,
} from '@/api/types'
import { emptyMeasures } from '@/lib/field-domain'
import {
  rotationOptionsOf,
  rotationVariantOf,
  summarizeRotationDistribution,
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
