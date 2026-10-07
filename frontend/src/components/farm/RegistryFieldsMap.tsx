import type { FeatureCollection } from 'geojson'
import { useMemo, useState } from 'react'
import MapView, { Layer, Source } from 'react-map-gl/maplibre'

import type { RegistryField } from '@/api/types'
import { loadMaplibre, MAP_STYLE_URL } from '@/components/farm/maplibre'
import { UI_COLORS } from '@/lib/brand-colors'
import { getFieldsBounds } from '@/lib/geo'
import type { LookupCatchment } from '@/lib/registry-lookup'

type RegistryFieldsMapProps = {
  fields: RegistryField[]
  catchments: LookupCatchment[]
}

export const RegistryFieldsMap = ({
  fields,
  catchments,
}: RegistryFieldsMapProps) => {
  const [mapLib] = useState(loadMaplibre)
  const data = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: fields.map((field) => ({
        type: 'Feature',
        geometry: field.geometry,
        properties: {
          color: catchments.find(
            (catchment) => catchment.catchmentId === field.catchmentId,
          )?.color,
        },
      })),
    }),
    [fields, catchments],
  )
  const bounds = getFieldsBounds(fields)
  if (bounds === null) return null

  return (
    <MapView
      mapLib={mapLib}
      mapStyle={MAP_STYLE_URL}
      initialViewState={{ bounds, fitBoundsOptions: { padding: 24 } }}
      interactive={false}
      style={{ width: '100%', height: '100%' }}
    >
      <Source id="lookup-fields" type="geojson" data={data}>
        <Layer
          id="lookup-fields-fill"
          type="fill"
          paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.85 }}
        />
        <Layer
          id="lookup-fields-outline"
          type="line"
          paint={{ 'line-color': UI_COLORS.sandBorder, 'line-width': 1 }}
        />
      </Source>
    </MapView>
  )
}
