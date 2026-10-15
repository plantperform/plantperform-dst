import { describe, expect, it } from 'vitest'

import type { GeoJSONPolygon } from '@/api/types'
import { fieldLabelPoint } from '@/lib/geo'

const square = (lng: number): GeoJSONPolygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, 55],
      [lng + 0.01, 55],
      [lng + 0.01, 55.01],
      [lng, 55.01],
      [lng, 55],
    ],
  ],
})

describe('fieldLabelPoint', () => {
  it('works out the point once for each geometry', () => {
    const field = { geometry: square(9) }
    const point = fieldLabelPoint(field)
    expect(point).not.toBeNull()
    expect(fieldLabelPoint({ ...field })).toBe(point)
    expect(fieldLabelPoint({ geometry: square(10) })).not.toEqual(point)
  })
})
