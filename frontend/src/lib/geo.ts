import type { FeatureCollection } from 'geojson'

import type { FieldRecord, GeoJSONMultiPolygon, GeoJSONPolygon } from '@/api/types'
import { isFieldLocked } from '@/lib/field-domain'

type Bounds = [number, number, number, number]

const expandBounds = (bounds: Bounds | null, [longitude, latitude]: [number, number]): Bounds => {
  if (!bounds) return [longitude, latitude, longitude, latitude]

  return [
    Math.min(bounds[0], longitude),
    Math.min(bounds[1], latitude),
    Math.max(bounds[2], longitude),
    Math.max(bounds[3], latitude),
  ]
}

const walkGeometry = (
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon,
  visit: (position: [number, number]) => void,
) => {
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring) => ring.forEach(visit))
    return
  }

  geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => ring.forEach(visit)))
}

export const getFieldsBounds = (fields: FieldRecord[]): Bounds | null => {
  let bounds: Bounds | null = null

  fields.forEach((field) => {
    if (!field.geometry) return

    walkGeometry(field.geometry, (position) => {
      bounds = expandBounds(bounds, position)
    })
  })

  return bounds
}

export const fieldLabelPoint = (
  field: FieldRecord,
): [number, number] | null => {
  const bounds = getFieldsBounds([field])
  if (!bounds) return null

  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
}

export const fieldsToFeatureCollection = (
  fields: FieldRecord[],
  changedFieldIds?: Set<string>,
): FeatureCollection => ({
  type: 'FeatureCollection',
  features: fields
    .filter((field): field is FieldRecord & { geometry: GeoJSONPolygon | GeoJSONMultiPolygon } => field.geometry !== null)
    .map((field) => ({
      type: 'Feature',
      properties: {
        fieldId: field.id,
        imkId: field.imkId,
        kystvandId: field.kystvandId,
        name: field.name,
        retention: field.retention,
        jbnr: field.jbnr,
        udledningsgraenseKgnHa: field.udledningsgraenseKgnHa,
        udledningskvoteMarkKgn: field.udledningskvoteMarkKgn,
        leaching: field.leaching,
        nLoad: field.nLoad,
        db2: field.db2,
        rotationChanged: changedFieldIds?.has(field.id) ? 1 : 0,
        inTakeoutPlan: field.inTakeoutPlan !== 'nej' ? 1 : 0,
        kvotegivende: field.kvotegivende ? 1 : 0,
        fieldLocked: isFieldLocked(field) ? 1 : 0,
      },
      geometry: field.geometry,
    })),
})
