import { describe, expect, it } from 'vitest'

import type { Farm, FieldRecord } from '@/api/types'
import {
  describeFarmQuotaStatus,
  describeLastOpened,
  farmMatchesSearch,
  farmStatusCatchmentId,
  formatFarmCount,
  sortFarmsByQuotaPressure,
  summarizeFarmFields,
} from '@/lib/farm-overview'
import { emptyMeasures } from '@/lib/field-domain'

const field = (overrides: Partial<FieldRecord>): FieldRecord => ({
  id: 'field',
  farmId: 'farm',
  imkId: null,
  catchmentId: null,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId: null,
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 0,
  nLoad: 0,
  leaching: 0,
  feedUnits: 0,
  name: 'Mark',
  areaHa: 1,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
  ...overrides,
})

const inCatchment = (
  catchmentId: number,
  nLoad: number,
  nLoadQuotaKgN: number,
): FieldRecord =>
  field({ id: `field-${catchmentId}`, catchmentId, nLoad, nLoadQuotaKgN })

const farm = (overrides: Partial<Farm>): Farm => ({
  id: 'farm',
  cvr: '12345678',
  name: 'Bakkegården',
  ownerName: 'Anders Bak',
  rotationLibrary: [],
  ...overrides,
})

const CATCHMENT_NAMES: Record<number, string> = {
  1: 'Basnæs Nor',
  2: 'Karrebæk Fjord',
}

const catchmentLabel = (catchmentId: number) => CATCHMENT_NAMES[catchmentId]

describe('describeFarmQuotaStatus', () => {
  it('names the catchment that is over the quota', () => {
    const overview = summarizeFarmFields([
      inCatchment(1, 110, 100),
      inCatchment(2, 50, 100),
    ])

    expect(farmStatusCatchmentId(overview)).toBe(1)
    expect(describeFarmQuotaStatus(overview, catchmentLabel)).toBe(
      'Basnæs Nor over kvoten',
    )
  })

  it('counts the catchments when more than one is over the quota', () => {
    const overview = summarizeFarmFields([
      inCatchment(1, 110, 100),
      inCatchment(2, 120, 100),
    ])

    expect(farmStatusCatchmentId(overview)).toBeNull()
    expect(describeFarmQuotaStatus(overview, catchmentLabel)).toBe(
      '2 oplande over kvoten',
    )
  })

  it('names the catchment that is close to the quota', () => {
    const overview = summarizeFarmFields([inCatchment(2, 95, 100)])

    expect(farmStatusCatchmentId(overview)).toBe(2)
    expect(describeFarmQuotaStatus(overview, catchmentLabel)).toBe(
      'Tæt på kvoten i Karrebæk Fjord',
    )
  })

  it('needs no catchment name for a farm under the quota', () => {
    const overview = summarizeFarmFields([
      inCatchment(1, 50, 100),
      inCatchment(2, 60, 100),
    ])

    expect(farmStatusCatchmentId(overview)).toBeNull()
    expect(describeFarmQuotaStatus(overview, catchmentLabel)).toBe(
      'Under kvoten',
    )
  })

  it('says that a farm without fields has none yet', () => {
    expect(
      describeFarmQuotaStatus(summarizeFarmFields([]), catchmentLabel),
    ).toBe('Ingen marker endnu')
  })

  it('says when the figures could not be fetched', () => {
    expect(
      describeFarmQuotaStatus(summarizeFarmFields(undefined), catchmentLabel),
    ).toBe('Kunne ikke hente tal')
  })

  it('says when the fields are not calculated', () => {
    expect(
      describeFarmQuotaStatus(
        summarizeFarmFields([inCatchment(1, 0, 100)]),
        catchmentLabel,
      ),
    ).toBe('Ikke beregnet')
  })
})

describe('sortFarmsByQuotaPressure', () => {
  it('puts the farms over the quota first and the farms without fields last', () => {
    const fieldsByFarm: Record<string, FieldRecord[]> = {
      under: [inCatchment(1, 50, 100)],
      empty: [],
      over: [inCatchment(1, 110, 100)],
      nearlyNear: [inCatchment(1, 80, 100)],
      near: [inCatchment(1, 95, 100)],
      uncalculated: [inCatchment(1, 0, 100)],
    }
    const farms = Object.keys(fieldsByFarm).map((id) => farm({ id }))
    const overviews = Object.fromEntries(
      Object.entries(fieldsByFarm).map(([id, fields]) => [
        id,
        summarizeFarmFields(fields),
      ]),
    )

    expect(
      sortFarmsByQuotaPressure(farms, overviews).map(({ id }) => id),
    ).toEqual(['over', 'near', 'nearlyNear', 'under', 'uncalculated', 'empty'])
  })

  it('sorts farms under the same pressure by name', () => {
    const farms = [
      farm({ id: 'b', name: 'Østergård' }),
      farm({ id: 'a', name: 'Højgård' }),
    ]
    const overview = summarizeFarmFields([inCatchment(1, 50, 100)])

    expect(
      sortFarmsByQuotaPressure(farms, { a: overview, b: overview }).map(
        ({ name }) => name,
      ),
    ).toEqual(['Højgård', 'Østergård'])
  })
})

describe('describeLastOpened', () => {
  const now = new Date(2026, 9, 8, 10, 30).getTime()
  const at = (day: number, hour: number) =>
    new Date(2026, 9, day, hour, 0).getTime()

  it('counts calendar days, not hours', () => {
    expect(describeLastOpened(at(8, 8), now)).toBe('i dag')
    expect(describeLastOpened(at(7, 23), now)).toBe('i går')
    expect(describeLastOpened(at(5, 12), now)).toBe('3 dage siden')
  })

  it('goes from days to weeks and months', () => {
    expect(describeLastOpened(at(-1, 12), now)).toBe('sidste uge')
    expect(describeLastOpened(at(-13, 12), now)).toBe('3 uger siden')
    expect(describeLastOpened(at(-82, 12), now)).toBe('3 måneder siden')
  })

  it('calls a farm that has never been opened new', () => {
    expect(describeLastOpened(undefined, now)).toBe('ny')
  })
})

describe('farmMatchesSearch', () => {
  const bakkegaarden = farm({})

  it('searches the name, the owner and the CVR number', () => {
    expect(farmMatchesSearch(bakkegaarden, 'bakke')).toBe(true)
    expect(farmMatchesSearch(bakkegaarden, 'anders')).toBe(true)
    expect(farmMatchesSearch(bakkegaarden, '3456')).toBe(true)
    expect(farmMatchesSearch(bakkegaarden, 'højgård')).toBe(false)
  })

  it('finds a CVR number typed in pairs as it is shown', () => {
    expect(farmMatchesSearch(bakkegaarden, '12 34 56')).toBe(true)
  })

  it('keeps every farm when nothing is typed', () => {
    expect(farmMatchesSearch(bakkegaarden, '  ')).toBe(true)
  })
})

describe('formatFarmCount', () => {
  it('counts one farm in the singular', () => {
    expect(formatFarmCount(1)).toBe('1 bedrift')
    expect(formatFarmCount(5)).toBe('5 bedrifter')
  })
})
