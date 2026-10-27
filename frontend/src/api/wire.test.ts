import { describe, expect, it } from 'vitest'

import { fromWire, toWire } from '@/api/wire'

describe('fromWire', () => {
  it('gives the backend names their glossary names at every depth', () => {
    expect(
      fromWire({
        fields: [
          {
            kystvandId: 7,
            marknr: '12-0',
            areaHa: 4.2,
            geometry: null,
            cropRotation: [{ afgrodeKode: 1, afgrodeNavn: 'Vårbyg' }],
          },
        ],
      }),
    ).toEqual({
      fields: [
        {
          catchmentId: 7,
          fieldNumber: '12-0',
          areaHa: 4.2,
          geometry: null,
          cropRotation: [{ cropCode: 1, cropName: 'Vårbyg' }],
        },
      ],
    })
  })

  it('names every cost category of a dækningsbidrag', () => {
    expect(
      fromWire({
        goedning: 1,
        andre_goedningsstoffer: 2,
        udsaed: 3,
        plantevaern: 4,
        markarbejde: 5,
        toerring: 6,
        andet: 7,
      }),
    ).toEqual({
      fertiliserCost: 1,
      otherFertilisers: 2,
      seed: 3,
      cropProtection: 4,
      fieldWork: 5,
      drying: 6,
      other: 7,
    })
  })

  it('leaves a geometry as the backend sent it', () => {
    const geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [9.1, 55.2],
          [9.2, 55.2],
          [9.1, 55.3],
          [9.1, 55.2],
        ],
      ],
    }

    expect(fromWire({ geometry })).toEqual({ geometry })
  })
})

describe('toWire', () => {
  it('sends the backend names', () => {
    expect(
      toWire({ catchmentId: 7, fertiliser: { mineralSharePct: 40 } }),
    ).toEqual({ kystvandId: 7, godning: { mineralskAndelPct: 40 } })
  })

  it('keeps a name that only responses translate', () => {
    expect(toWire({ name: 'Bakkegården' })).toEqual({ name: 'Bakkegården' })
  })
})
