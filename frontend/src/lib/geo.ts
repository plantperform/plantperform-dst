import type { Feature, FeatureCollection } from 'geojson'

import type { FieldRecord, GeoJSONMultiPolygon, GeoJSONPolygon } from '@/api/types'
import { classifyCrop, CROP_GROUP_INDEX } from '@/lib/crop-groups'
import { isFieldLocked, quotaStatusLevel } from '@/lib/field-domain'
import { YEAR_QUOTA_STATUS_VALUES } from '@/lib/map-coloring'

export type FieldYearProperties = {
  yearIndex: number
  nLoadKgHaByFieldId: Record<string, number>
}

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

type Ring = [number, number][]

const ringArea = (ring: Ring): number => {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  }
  return Math.abs(sum) / 2
}

const pointInRing = (point: [number, number], ring: Ring): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

const distanceToSegment = (
  point: [number, number],
  a: [number, number],
  b: [number, number],
  xScale: number,
): number => {
  const dx = (b[0] - a[0]) * xScale
  const dy = b[1] - a[1]
  const px = (point[0] - a[0]) * xScale
  const py = point[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared))
  return Math.hypot(px - t * dx, py - t * dy)
}

const distanceInsidePolygon = (
  point: [number, number],
  rings: Ring[],
  xScale: number,
): number => {
  if (!pointInRing(point, rings[0])) return -1
  for (const hole of rings.slice(1)) {
    if (pointInRing(point, hole)) return -1
  }
  let nearest = Number.POSITIVE_INFINITY
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      nearest = Math.min(
        nearest,
        distanceToSegment(point, ring[j], ring[i], xScale),
      )
    }
  }
  return nearest
}

const LABEL_GRID_STEPS = 24

const searchLabelPoint = (
  rings: Ring[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  xScale: number,
): { point: [number, number]; distance: number } | null => {
  let best: { point: [number, number]; distance: number } | null = null
  const centre: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2]
  const centreDistance = (point: [number, number]) =>
    Math.hypot((point[0] - centre[0]) * xScale, point[1] - centre[1])
  const tolerance = Math.max(maxX - minX, maxY - minY) / LABEL_GRID_STEPS / 4
  for (let row = 0; row <= LABEL_GRID_STEPS; row += 1) {
    for (let column = 0; column <= LABEL_GRID_STEPS; column += 1) {
      const candidate: [number, number] = [
        minX + ((maxX - minX) * column) / LABEL_GRID_STEPS,
        minY + ((maxY - minY) * row) / LABEL_GRID_STEPS,
      ]
      const distance = distanceInsidePolygon(candidate, rings, xScale)
      if (distance < 0) continue
      const better =
        best === null ||
        distance > best.distance + tolerance ||
        (distance >= best.distance - tolerance &&
          centreDistance(candidate) < centreDistance(best.point))
      if (better) best = { point: candidate, distance }
    }
  }
  return best
}

export const polygonLabelPoint = (rings: Ring[]): [number, number] | null => {
  const outer = rings[0]
  if (!outer || outer.length < 3) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of outer) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const xScale = Math.cos((((minY + maxY) / 2) * Math.PI) / 180)
  const coarse = searchLabelPoint(rings, minX, minY, maxX, maxY, xScale)
  if (!coarse) return null
  const cellX = (maxX - minX) / LABEL_GRID_STEPS
  const cellY = (maxY - minY) / LABEL_GRID_STEPS
  const fine = searchLabelPoint(
    rings,
    coarse.point[0] - cellX,
    coarse.point[1] - cellY,
    coarse.point[0] + cellX,
    coarse.point[1] + cellY,
    xScale,
  )
  return fine && fine.distance > coarse.distance ? fine.point : coarse.point
}

const largestPolygonRings = (
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon,
): Ring[] => {
  if (geometry.type === 'Polygon') return geometry.coordinates
  let largest: Ring[] = []
  let largestArea = -1
  for (const polygon of geometry.coordinates) {
    const area = polygon[0] ? ringArea(polygon[0]) : 0
    if (area > largestArea) {
      largestArea = area
      largest = polygon
    }
  }
  return largest
}

export const fieldLabelPoint = (
  field: FieldRecord,
): [number, number] | null => {
  const bounds = getFieldsBounds([field])
  if (!bounds) return null
  const fallback: [number, number] = [
    (bounds[0] + bounds[2]) / 2,
    (bounds[1] + bounds[3]) / 2,
  ]
  if (!field.geometry) return fallback
  return polygonLabelPoint(largestPolygonRings(field.geometry)) ?? fallback
}

export const fieldsToFeatureCollection = (
  fields: FieldRecord[],
  changedFieldIds?: Set<string>,
  yearProperties?: FieldYearProperties,
): FeatureCollection => ({
  type: 'FeatureCollection',
  features: fields
    .filter((field): field is FieldRecord & { geometry: GeoJSONPolygon | GeoJSONMultiPolygon } => field.geometry !== null)
    .map((field): Feature => {
      const yearRotation =
        yearProperties !== undefined
          ? (field.cropRotation[yearProperties.yearIndex] ?? null)
          : null
      const yearNLoadKgHa = yearProperties?.nLoadKgHaByFieldId[field.id] ?? null
      const yearQuotaLevel =
        yearNLoadKgHa === null
          ? null
          : quotaStatusLevel(
              yearNLoadKgHa * field.areaHa,
              field.udledningskvoteMarkKgn,
              true,
            )
      const yearQuotaStatus =
        yearQuotaLevel === 'ok' || yearQuotaLevel === 'near' || yearQuotaLevel === 'over'
          ? YEAR_QUOTA_STATUS_VALUES[yearQuotaLevel]
          : null
      // Map colouring bins (leaching/nLoad/db2 in map-coloring.ts) are all
      // labelled per hectare, so the GeoJSON properties they read must be
      // per hectare too - field.leaching/nLoad/db2 themselves are the
      // mark's totals (see FieldRecord), used as-is everywhere else.
      const perHa = field.areaHa > 0 ? (value: number) => value / field.areaHa : () => null
      return {
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
          leaching: perHa(field.leaching),
          nLoad: perHa(field.nLoad),
          db2: perHa(field.db2),
          rotationChanged: changedFieldIds?.has(field.id) ? 1 : 0,
          inTakeoutPlan: field.inTakeoutPlan !== 'nej' ? 1 : 0,
          kvotegivende: field.kvotegivende ? 1 : 0,
          fieldLocked: isFieldLocked(field) ? 1 : 0,
          yearAfgrodeNavn: yearRotation?.afgrodeNavn ?? null,
          yearCropGroup: yearRotation
            ? CROP_GROUP_INDEX[
                classifyCrop(yearRotation.afgrodeKode, yearRotation.afgrodeNavn)
              ]
            : null,
          yearNLoadKgHa,
          yearQuotaStatus,
        },
        geometry: field.geometry,
      }
    }),
})

const MERCATOR_TILE_SIZE = 512

const mercatorPixel = (
  point: [number, number],
  zoom: number,
): [number, number] => {
  const worldSize = MERCATOR_TILE_SIZE * 2 ** zoom
  const latRad = (point[1] * Math.PI) / 180
  const x = ((point[0] + 180) / 360) * worldSize
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    worldSize
  return [x, y]
}

export type PixelCluster<T> = {
  items: T[]
  center: [number, number]
}

export const clusterByPixelDistance = <T>(
  items: T[],
  pointOf: (item: T) => [number, number],
  zoom: number,
  thresholdPx: number,
): PixelCluster<T>[] => {
  const clusters: { items: T[]; pixels: [number, number][]; points: [number, number][] }[] = []
  for (const item of items) {
    const point = pointOf(item)
    const pixel = mercatorPixel(point, zoom)
    const target = clusters.find((cluster) => {
      const cx = cluster.pixels.reduce((sum, p) => sum + p[0], 0) / cluster.pixels.length
      const cy = cluster.pixels.reduce((sum, p) => sum + p[1], 0) / cluster.pixels.length
      return Math.hypot(cx - pixel[0], cy - pixel[1]) < thresholdPx
    })
    if (target) {
      target.items.push(item)
      target.pixels.push(pixel)
      target.points.push(point)
    } else {
      clusters.push({ items: [item], pixels: [pixel], points: [point] })
    }
  }
  return clusters.map((cluster) => ({
    items: cluster.items,
    center: [
      cluster.points.reduce((sum, p) => sum + p[0], 0) / cluster.points.length,
      cluster.points.reduce((sum, p) => sum + p[1], 0) / cluster.points.length,
    ],
  }))
}
