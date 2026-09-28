import { describe, expect, it } from 'vitest'

import type { FieldRecord } from '@/api/types'
import {
  emptyMeasures,
  formatCompactDkk,
  type CatchmentTotalsByYear,
} from '@/lib/field-domain'
import {
  alignCatchmentYears,
  bestColumnIndex,
  catchmentQuotas,
  comparisonAvailability,
  curveCeilingPct,
  curveLeftPct,
  curveSegments,
  curveTopPct,
  defaultComparisonIds,
  describeCatchmentYearsOver,
  describeComparisonAvailability,
  describeComparisonVerdict,
  describeFeedUnitRequirement,
  formatDkkDelta,
  formatFeedUnits,
  formatKgN,
  formatYearsDelta,
  hasMissingYearValues,
  listComparedCatchments,
  parseComparisonIds,
  placeFeedUnitRequirements,
  rankByBalance,
  resolveComparisonIds,
  shareOfMax,
  sortComparison,
  summarizeCatchmentComparison,
  summarizeColumnQuota,
  toggleComparisonId,
  type ComparisonSort,
} from '@/lib/simulation-comparison'

const field = (id: string, rotationId: string | null): FieldRecord => ({
  id,
  farmId: 'farm',
  imkId: null,
  catchmentId: 7,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId,
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 0,
  nLoad: 0,
  leaching: 0,
  feedUnits: 0,
  name: id,
  areaHa: 1,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 0,
  quotaEligible: true,
  geometry: null,
})

describe('parseComparisonIds', () => {
  it('reads comma separated ids and skips empty entries', () => {
    expect(parseComparisonIds(' a,b,,c ')).toEqual(['a', 'b', 'c'])
  })

  it('reads a missing parameter as no ids', () => {
    expect(parseComparisonIds(null)).toEqual([])
  })
})

describe('resolveComparisonIds', () => {
  it('keeps selectable ids in order without duplicates, at most three', () => {
    expect(
      resolveComparisonIds(
        ['unknown', 'a', 'a', 'b', 'c', 'd'],
        new Set(['a', 'b', 'c', 'd']),
      ),
    ).toEqual(['a', 'b', 'c'])
  })
})

describe('defaultComparisonIds', () => {
  it('picks the newest selectable simulations, at most three', () => {
    const simulations = [
      { id: 'oldest', createdAt: '2026-09-01T08:00:00Z' },
      { id: 'newest', createdAt: '2026-09-24T08:00:00Z' },
      { id: 'not-calculated', createdAt: '2026-09-25T08:00:00Z' },
      { id: 'middle', createdAt: '2026-09-10T08:00:00Z' },
      { id: 'newer', createdAt: '2026-09-20T08:00:00Z' },
    ]
    expect(
      defaultComparisonIds(
        simulations,
        new Set(['oldest', 'newest', 'middle', 'newer']),
      ),
    ).toEqual(['newest', 'newer', 'middle'])
  })
})

describe('toggleComparisonId', () => {
  it('adds an id at the end', () => {
    expect(toggleComparisonId(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('removes a chosen id', () => {
    expect(toggleComparisonId(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('adds nothing when three are chosen', () => {
    expect(toggleComparisonId(['a', 'b', 'c'], 'd')).toEqual(['a', 'b', 'c'])
  })
})

describe('comparisonAvailability', () => {
  it('is ready when every field is calculated', () => {
    expect(
      comparisonAvailability([field('1', 'r1'), field('2', 'r2')]),
    ).toEqual({ kind: 'ready' })
  })

  it('counts the fields that are not calculated', () => {
    expect(
      comparisonAvailability([
        field('1', 'r1'),
        field('2', null),
        field('3', null),
      ]),
    ).toEqual({ kind: 'partial', missingCount: 2 })
  })

  it('is not calculated when no field is', () => {
    expect(comparisonAvailability([field('1', null)])).toEqual({
      kind: 'uncalculated',
    })
    expect(comparisonAvailability([])).toEqual({ kind: 'uncalculated' })
  })
})

describe('describeComparisonAvailability', () => {
  it('says why a simulation cannot be chosen', () => {
    expect(describeComparisonAvailability({ kind: 'uncalculated' })).toBe(
      'Ikke beregnet',
    )
    expect(
      describeComparisonAvailability({ kind: 'partial', missingCount: 1 }),
    ).toBe('1 mark ikke beregnet')
    expect(
      describeComparisonAvailability({ kind: 'partial', missingCount: 3 }),
    ).toBe('3 marker ikke beregnet')
    expect(describeComparisonAvailability({ kind: 'ready' })).toBeNull()
  })
})

describe('bestColumnIndex', () => {
  it('finds the highest value', () => {
    expect(bestColumnIndex([100, 300, 200], 'highest', formatKgN)).toBe(1)
  })

  it('finds the lowest value', () => {
    expect(bestColumnIndex([100, 300, 200], 'lowest', formatKgN)).toBe(0)
  })

  it('marks nothing when the best values look the same', () => {
    expect(
      bestColumnIndex(
        [1_240_000, 1_210_000, 900_000],
        'highest',
        formatCompactDkk,
      ),
    ).toBeNull()
  })

  it('leaves out columns without a value', () => {
    expect(bestColumnIndex([null, 5, 7], 'lowest', formatKgN)).toBe(1)
  })

  it('marks nothing with fewer than two values', () => {
    expect(bestColumnIndex([null, 5], 'lowest', formatKgN)).toBeNull()
  })
})

describe('describeFeedUnitRequirement', () => {
  it('describes a minimum, a maximum and both', () => {
    expect(
      describeFeedUnitRequirement({
        minFeedUnits: 230_000,
        maxFeedUnits: null,
      }),
    ).toBe('Krav mindst 230.000 FE')
    expect(
      describeFeedUnitRequirement({
        minFeedUnits: null,
        maxFeedUnits: 250_000,
      }),
    ).toBe('Krav højst 250.000 FE')
    expect(
      describeFeedUnitRequirement({
        minFeedUnits: 200_000,
        maxFeedUnits: 250_000,
      }),
    ).toBe('Krav 200.000-250.000 FE')
  })

  it('has no text without a requirement', () => {
    expect(
      describeFeedUnitRequirement({ minFeedUnits: null, maxFeedUnits: null }),
    ).toBeNull()
  })
})

describe('placeFeedUnitRequirements', () => {
  it('puts a shared requirement under the row name', () => {
    const requirement = 'Krav mindst 230.000 FE'
    expect(
      placeFeedUnitRequirements([null, requirement, null, requirement]),
    ).toEqual({ label: requirement, cells: [null, null, null, null] })
  })

  it('puts different requirements under each cell', () => {
    expect(placeFeedUnitRequirements([null, 'A', 'B'])).toEqual({
      label: null,
      cells: [null, 'A', 'B'],
    })
  })

  it('has no text when no column has a requirement', () => {
    expect(placeFeedUnitRequirements([null, null])).toEqual({
      label: null,
      cells: [null, null],
    })
  })
})

describe('formatKgN and formatFeedUnits', () => {
  it('round to whole units with Danish thousands separators', () => {
    expect(formatKgN(1234.4)).toBe('1.234 kg N')
    expect(formatFeedUnits(230_000)).toBe('230.000 FE')
  })
})

const years = (entries: Record<number, [nLoadKg: number, quotaKgN: number]>) =>
  Object.fromEntries(
    Object.entries(entries).map(([year, [nLoadKg, quotaKgN]]) => [
      Number(year),
      { nLoadKg, quotaKgN, fieldCount: 1 },
    ]),
  )

describe('alignCatchmentYears', () => {
  it('lays the crop history 2019-2026 over 2027-2034', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 2019: [10, 100], 2026: [20, 100] })],
    ])
    expect(alignCatchmentYears(totals, true)).toEqual(
      new Map([[7, years({ 2027: [10, 100], 2034: [20, 100] })]]),
    )
  })

  it('turns the simulation years 1-8 into 2027-2034', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 1: [10, 100], 8: [20, 100] })],
      [null, years({ 1: [5, 0] })],
    ])
    expect(alignCatchmentYears(totals, false)).toEqual(
      new Map([
        [7, years({ 2027: [10, 100], 2034: [20, 100] })],
        [null, years({ 2027: [5, 0] })],
      ]),
    )
  })
})

describe('summarizeCatchmentComparison', () => {
  it('averages the years with a quota and gives each year in percent of the quota', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 2027: [90, 100], 2028: [110, 100], 2029: [0, 0] })],
    ])
    expect(summarizeCatchmentComparison(7, totals)).toEqual({
      status: { catchmentId: 7, level: 'over', overYears: [2028] },
      complete: true,
      average: { nLoadKg: 100, quotaPct: 100 },
      years: [
        { year: 2027, quotaPct: 90, level: 'near' },
        { year: 2028, quotaPct: (110 / 100) * 100, level: 'over' },
        { year: 2029, quotaPct: null, level: 'noData' },
        { year: 2030, quotaPct: null, level: 'noData' },
        { year: 2031, quotaPct: null, level: 'noData' },
        { year: 2032, quotaPct: null, level: 'noData' },
        { year: 2033, quotaPct: null, level: 'noData' },
        { year: 2034, quotaPct: null, level: 'noData' },
      ],
    })
  })

  it('rates each year against its quota like the quota status', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [
        7,
        years({
          2027: [89, 100],
          2028: [90, 100],
          2029: [100, 100],
          2030: [101, 100],
        }),
      ],
    ])
    expect(
      summarizeCatchmentComparison(7, totals)
        ?.years.slice(0, 4)
        .map(({ level }) => level),
    ).toEqual(['ok', 'near', 'near', 'over'])
  })

  it('has nothing to compare when the catchment has no quota', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 2027: [40, 0] })],
    ])
    expect(summarizeCatchmentComparison(7, totals)).toBeNull()
    expect(summarizeCatchmentComparison(9, totals)).toBeNull()
  })

  it('measures a partly calculated catchment against its full quota', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 2027: [60, 50], 2028: [40, 50] })],
    ])
    const comparison = summarizeCatchmentComparison(7, totals, 150)
    expect(comparison).toMatchObject({
      status: { catchmentId: 7, level: 'partial', overYears: [] },
      complete: false,
      average: { nLoadKg: 50, quotaPct: (100 / 300) * 100 },
    })
    expect(comparison?.years[0]).toEqual({
      year: 2027,
      quotaPct: (60 / 150) * 100,
      level: 'ok',
    })
  })

  it('has only the status when no field in the catchment has figures', () => {
    expect(summarizeCatchmentComparison(7, new Map(), 150)).toMatchObject({
      status: { catchmentId: 7, level: 'partial', overYears: [] },
      complete: false,
      average: null,
    })
  })

  it('keeps a year over the full quota when the catchment is partly calculated', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [7, years({ 2027: [160, 100], 2028: [70, 100] })],
    ])
    expect(summarizeCatchmentComparison(7, totals, 150)).toMatchObject({
      status: { catchmentId: 7, level: 'over', overYears: [2027] },
      complete: false,
    })
  })
})

describe('listComparedCatchments', () => {
  it('lists catchments with a quota in any column, sorted by name', () => {
    const labels: Record<number, string> = {
      3: 'Øresund',
      4: 'Lillebælt',
      5: 'Limfjorden',
      9: 'Als Fjord',
    }
    const first: CatchmentTotalsByYear = new Map([
      [3, years({ 2027: [10, 100] })],
      [5, years({ 2027: [10, 0] })],
      [null, years({ 2027: [10, 0] })],
    ])
    const second: CatchmentTotalsByYear = new Map([
      [9, years({ 2027: [10, 100] })],
    ])
    expect(
      listComparedCatchments(
        [
          { catchments: first, partialQuotas: new Map([[4, 80]]) },
          { catchments: undefined, partialQuotas: new Map() },
          { catchments: second, partialQuotas: new Map() },
        ],
        (catchmentId) => labels[catchmentId],
      ),
    ).toEqual([
      { catchmentId: 9, label: 'Als Fjord' },
      { catchmentId: 4, label: 'Lillebælt' },
      { catchmentId: 3, label: 'Øresund' },
    ])
  })
})

describe('hasMissingYearValues', () => {
  it('needs values for every simulation field with a rotation', () => {
    const fields = [field('1', 'r1'), field('2', 'r2'), field('3', null)]
    expect(hasMissingYearValues(fields, { 1: [], 2: [] }, false)).toBe(false)
    expect(hasMissingYearValues(fields, { 1: [] }, false)).toBe(true)
  })

  it('needs values for every history field with numbers', () => {
    const withNumbers = { ...field('1', null), db2: 100 }
    const withoutNumbers = field('2', null)
    expect(
      hasMissingYearValues([withNumbers, withoutNumbers], { 1: [] }, true),
    ).toBe(false)
    expect(hasMissingYearValues([withNumbers, withoutNumbers], {}, true)).toBe(
      true,
    )
  })
})

describe('summarizeColumnQuota', () => {
  it('counts the years over the quota across catchments and the catchments with any', () => {
    const totals: CatchmentTotalsByYear = new Map([
      [3, years({ 2027: [110, 100], 2028: [120, 100], 2029: [90, 100] })],
      [7, years({ 2027: [50, 100] })],
    ])
    expect(summarizeColumnQuota([3, 7, 9], totals, new Map())).toEqual({
      yearsOver: 2,
      catchmentsOver: 1,
    })
  })
})

describe('rankByBalance', () => {
  it('puts the fewest years over the quota first and the highest DB2 among equals', () => {
    const ranked = rankByBalance([
      { key: 'a', db2: 500, yearsOver: 2 },
      { key: 'b', db2: 300, yearsOver: 0 },
      { key: 'c', db2: 900, yearsOver: 2 },
      { key: 'd', db2: 400, yearsOver: 0 },
      { key: 'e', db2: 1000, yearsOver: null },
    ])
    expect(ranked.map(({ key }) => key)).toEqual(['d', 'b', 'c', 'a', 'e'])
  })
})

describe('sortComparison', () => {
  const candidates = [
    { key: 'a', db2: 500, nLoad: 30, yearsOver: 2 },
    { key: 'b', db2: 300, nLoad: 10, yearsOver: 0 },
    { key: 'c', db2: 900, nLoad: 20, yearsOver: 2 },
    { key: 'd', db2: 400, nLoad: 40, yearsOver: 0 },
    { key: 'e', db2: null, nLoad: null, yearsOver: null },
  ]
  const keys = (sort: ComparisonSort) =>
    sortComparison(candidates, sort).map(({ key }) => key)

  it('orders by balance and by years over the quota the same way', () => {
    expect(keys('balance')).toEqual(['d', 'b', 'c', 'a', 'e'])
    expect(keys('yearsOver')).toEqual(['d', 'b', 'c', 'a', 'e'])
  })

  it('puts the highest DB2 or the lowest N load first and no figures last', () => {
    expect(keys('db2')).toEqual(['c', 'a', 'd', 'b', 'e'])
    expect(keys('nLoad')).toEqual(['b', 'c', 'a', 'd', 'e'])
  })
})

describe('formatDkkDelta', () => {
  it('signs the difference in the unit of the larger figure', () => {
    expect(formatDkkDelta(249_000, 572_000)).toBe('+249 t.kr')
    expect(formatDkkDelta(877_000, 1_200_000)).toBe('+0,9 mio. kr')
    expect(formatDkkDelta(-737_000, 586_000)).toBe('−737 t.kr')
    expect(formatDkkDelta(0, 323_000)).toBe('±0 t.kr')
  })
})

describe('formatYearsDelta', () => {
  it('signs the change in years over the quota', () => {
    expect(formatYearsDelta(-6)).toBe('−6 år')
    expect(formatYearsDelta(0)).toBe('±0 år')
    expect(formatYearsDelta(2)).toBe('+2 år')
  })
})

describe('describeComparisonVerdict', () => {
  const historyDb2 = 323_000
  const test3 = { title: 'Test3', db2: 1_200_000, yearsOver: 0 }

  it('names the only simulation under the quota and what it earns more', () => {
    expect(
      describeComparisonVerdict({
        best: test3,
        compliantCount: 1,
        simulationCount: 3,
        historyDb2,
      }),
    ).toBe(
      'Test3 giver den bedste balance: eneste simulering under kvoten i alle år og alle oplande, og 0,9 mio. kr mere end afgrødehistorikken.',
    )
  })

  it('picks the highest DB2 when several are under the quota', () => {
    expect(
      describeComparisonVerdict({
        best: test3,
        compliantCount: 2,
        simulationCount: 3,
        historyDb2,
      }),
    ).toBe(
      'Test3 giver den bedste balance: højeste dækningsbidrag af dem, der er under kvoten i alle år og alle oplande, og 0,9 mio. kr mere end afgrødehistorikken.',
    )
  })

  it('names the one closest to the quota when none keeps it', () => {
    expect(
      describeComparisonVerdict({
        best: { title: 'Test2', db2: 1_300_000, yearsOver: 4 },
        compliantCount: 0,
        simulationCount: 3,
        historyDb2,
      }),
    ).toBe(
      'Ingen simulering holder kvoten i alle år. Test2 kommer tættest på med 4 år over kvoten.',
    )
  })

  it('describes a single simulation on its own', () => {
    expect(
      describeComparisonVerdict({
        best: test3,
        compliantCount: 1,
        simulationCount: 1,
        historyDb2,
      }),
    ).toBe(
      'Test3 holder kvoten i alle år og alle oplande og giver 0,9 mio. kr mere end afgrødehistorikken.',
    )
    expect(
      describeComparisonVerdict({
        best: { ...test3, yearsOver: 3 },
        compliantCount: 0,
        simulationCount: 1,
        historyDb2,
      }),
    ).toBe('Test3 holder ikke kvoten i alle år: 3 år over kvoten.')
  })

  it('has nothing to say without simulations or years', () => {
    expect(
      describeComparisonVerdict({
        best: { ...test3, yearsOver: null },
        compliantCount: 0,
        simulationCount: 1,
        historyDb2,
      }),
    ).toBeNull()
  })
})

describe('describeCatchmentYearsOver', () => {
  it('lists the years over the quota and says when there are none', () => {
    expect(
      describeCatchmentYearsOver({
        catchmentId: 7,
        level: 'over',
        overYears: [2029, 2031, 2032],
      }),
    ).toBe('over kvoten i 2029, 2031 og 2032')
    expect(
      describeCatchmentYearsOver({
        catchmentId: 7,
        level: 'near',
        overYears: [],
      }),
    ).toBe('under kvoten alle år')
    expect(
      describeCatchmentYearsOver({
        catchmentId: 7,
        level: 'partial',
        overYears: [],
      }),
    ).toBe('delvist beregnet')
  })
})

describe('shareOfMax', () => {
  it('gives a value as a share of the largest one', () => {
    expect(shareOfMax(50, 200)).toBe(25)
    expect(shareOfMax(-10, 200)).toBe(0)
    expect(shareOfMax(10, 0)).toBe(0)
  })
})

describe('curve geometry', () => {
  it('leaves room above the quota and the highest year', () => {
    expect(curveCeilingPct([140, null, 5])).toBe(150)
    expect(curveCeilingPct([138, 133, 160])).toBe(170)
  })

  it('places a year in the middle of its column and 100 % on the quota line', () => {
    expect(curveLeftPct(0, 8)).toBe(6.25)
    expect(curveLeftPct(7, 8)).toBe(93.75)
    expect(curveTopPct(100, 150)).toBeCloseTo(36)
    expect(curveTopPct(150, 150)).toBe(8)
  })

  it('breaks the curve where a year has no value', () => {
    expect(curveSegments([150, 150, null, 150], 150)).toEqual([
      '12.5,8 37.5,8',
      '87.5,8',
    ])
  })
})

describe('catchmentQuotas', () => {
  it('sums the quota of the kvotegivende fields per catchment', () => {
    const fields = [
      { ...field('1', null), catchmentId: 3, nLoadQuotaKgN: 100 },
      { ...field('2', null), catchmentId: 3, nLoadQuotaKgN: 50 },
      {
        ...field('3', null),
        catchmentId: 3,
        nLoadQuotaKgN: 70,
        quotaEligible: false,
      },
      { ...field('4', null), catchmentId: null, nLoadQuotaKgN: 40 },
      { ...field('5', null), catchmentId: 9, nLoadQuotaKgN: 0 },
    ]
    expect(catchmentQuotas(fields)).toEqual(new Map([[3, 150]]))
  })
})
