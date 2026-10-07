import 'maplibre-gl/dist/maplibre-gl.css'

import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

export const loadMaplibre = () =>
  import('maplibre-gl').then((maplibre) => {
    maplibre.setWorkerUrl(maplibreWorkerUrl)
    return maplibre
  })
