import { describe, expect, it } from 'vitest'

import type { FieldRecord, SavedResultView, SimulationView } from '@/api/types'
import {
  applyFieldAliases,
  applySavedResultAliases,
  applySimulationViewAliases,
  fieldAliasKey,
} from '@/lib/field-aliases'
import {
  fieldDisplayName,
  fieldMatchesQuery,
  fieldTitle,
} from '@/lib/field-domain'
import { compareFields } from '@/lib/field-sort'
import { fieldsToFeatureCollection } from '@/lib/geo'

const field = (
  id: string,
  farmId: string,
  imkId: number | null = 123,
): FieldRecord => ({
  id,
  farmId,
  imkId,
  name: `Original ${id}`,
  catchmentId: null,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId: null,
  measures: {
    precisionFarming: false,
    coverCropYears: [],
    earlySowingYears: [],
  },
  allowedRotationIds: [],
  db2: 0,
  nLoad: 0,
  leaching: 0,
  feedUnits: 0,
  areaHa: 1,
  inTakeoutPlan: 'nej',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
})

describe('personal field display names', () => {
  it('matches registry identity across farms and simulation UUIDs without changing shared names', () => {
    const original = [
      field('history', 'first'),
      field('another-farm', 'second'),
      field('snapshot', 'first'),
    ]
    const aliased = applyFieldAliases(original, { 'imk:123': 'Sømarken' })
    expect(aliased.map(fieldDisplayName)).toEqual([
      'Sømarken',
      'Sømarken',
      'Sømarken',
    ])
    expect(aliased.map(({ name }) => name)).toEqual(
      original.map(({ name }) => name),
    )
    expect(original.every(({ alias }) => alias === undefined)).toBe(true)
    expect(applyFieldAliases(aliased, {}).map(fieldDisplayName)).toEqual(
      original.map(({ name }) => name),
    )
  })

  it('supports legacy UUIDs and zero-valued registry identities without collisions', () => {
    const legacy = field('123', 'first', null)
    const registry = field('other', 'second')
    expect(fieldAliasKey(legacy)).toBe('field:123')
    expect(fieldAliasKey(field('zero', 'first', 0))).toBe('imk:0')
    expect(
      applyFieldAliases([legacy, registry], { 'field:123': 'Legacy' }).map(
        fieldDisplayName,
      ),
    ).toEqual(['Legacy', registry.name])
  })

  it('uses aliases verbatim and retains existing formatting for original names', () => {
    expect(fieldTitle({ name: '12', alias: 'Sømarken' })).toBe('Sømarken')
    expect(fieldTitle({ name: '12', alias: null })).toBe('Mark 12')
    expect(fieldTitle({ name: 'Mark 12' })).toBe('Mark 12')
    expect(
      fieldMatchesQuery({ name: '12', alias: 'Sømarken' }, ' SØMARK '),
    ).toBe(true)
    expect(fieldMatchesQuery({ name: '12', alias: 'Sømarken' }, '12')).toBe(
      true,
    )
    expect(
      fieldMatchesQuery({ name: '12', alias: 'Sømarken' }, 'missing'),
    ).toBe(false)
  })

  it('sorts on the displayed name while retaining existing identity tie-breakers', () => {
    const first = { ...field('a', 'first'), alias: 'Zebra' }
    const second = { ...field('z', 'first'), alias: 'And' }
    const sorted = [first, second].sort((a, b) =>
      compareFields(a, b, { key: 'name', direction: 'asc' }),
    )
    expect(sorted.map(({ id }) => id)).toEqual(['z', 'a'])
  })

  it('projects saved comparison fields and their baselines without modifying calculation snapshots', () => {
    const saved: SavedResultView = {
      runId: 'run',
      resultRevision: 3,
      response: {
        fields: [field('result', 'first')],
        objectiveDb2: 100,
        status: 'OPTIMAL',
        totalNLoadKg: 0,
        totalLeachingKg: 0,
        totalFeedUnits: 0,
        assignments: [],
      },
      fieldsBefore: [field('before', 'first')],
      fieldYears: {},
    }
    const projected = applySavedResultAliases(saved, { 'imk:123': 'New alias' })
    expect(projected.response.fields[0].alias).toBe('New alias')
    expect(projected.fieldsBefore[0].alias).toBe('New alias')
    expect(projected.resultRevision).toBe(saved.resultRevision)
    expect(projected.response.objectiveDb2).toBe(saved.response.objectiveDb2)
    expect(saved.response.fields[0].alias).toBeUndefined()
    const view = {
      status: 'done',
      inputRevision: 3,
      viewVersion: 2,
      data: { fields: [field('setup', 'first')], savedResult: saved },
    } as SimulationView
    const aliased = applySimulationViewAliases(view, {
      'imk:123': 'New alias',
    })!
    expect(aliased.data?.fields[0].alias).toBe('New alias')
    expect(aliased.data?.savedResult?.response.fields[0].alias).toBe(
      'New alias',
    )
    expect(aliased.viewVersion).toBe(2)
    expect(aliased.inputRevision).toBe(3)
    expect(applySimulationViewAliases({ ...view, data: null }, {})).toEqual({
      ...view,
      data: null,
    })
  })

  it('uses the personal name in map features and restores the original when cleared', () => {
    const value: FieldRecord = {
      ...field('polygon', 'first'),
      alias: 'Personal map label',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    }
    expect(
      fieldsToFeatureCollection([value], false).features[0].properties?.name,
    ).toBe('Personal map label')
    expect(
      fieldsToFeatureCollection(applyFieldAliases([value], {}), false)
        .features[0].properties?.name,
    ).toBe(value.name)
  })
})
