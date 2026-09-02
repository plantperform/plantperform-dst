import 'maplibre-gl/dist/maplibre-gl.css'

import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import Map, {
  Layer,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import { mutate } from 'swr'

import { getAccessToken } from '@/api/auth'
import { API_BASE, fetcher } from '@/api/client'
import { farmFieldsKey, farmKey, registryFieldsBulkKey, useFarmFields } from '@/api/hooks'
import { createFields, detachField } from '@/api/mutations'
import type {
  CreateFieldInput,
  Farm,
  FieldRecord,
  RegistryBounds,
  RegistryField,
  RegistryFieldSummary,
} from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { changedFieldIds, formatRealRotation } from '@/lib/field-domain'
import { fieldsToFeatureCollection, getFieldsBounds } from '@/lib/geo'
import {
  ATTRIBUTE_OPTIONS,
  COLOR_SPECS,
  buildFillColor,
  legendEntries,
  registryPropertyFor,
  type ColorAttribute,
} from '@/lib/map-coloring'

const formatNumber = (value: number) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 }).format(value)

const emptyFeatureCollection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}
const registryPointMinZoom = 6
const registryPolygonMinZoom = 11
const marsPolygonMinZoom = 11
const defaultMapViewState = { longitude: 10.1, latitude: 56.1, zoom: 7 }

type SavedMapViewState = typeof defaultMapViewState & {
  bearing: number
  pitch: number
}

const savedMapViewStates = new globalThis.Map<string, SavedMapViewState>()

// Colour groups for the MARS "virkemiddel" layer. Everything not listed
// (Ekstensivering, Øvrige, ...) falls back to MARS_OTHER_COLOR.
const MARS_LEGEND: { label: string; color: string; virkemidler: string[] }[] = [
  {
    label: 'Vådområder',
    color: '#7c3aed',
    virkemidler: [
      'Kvælstofvådområder',
      'Minivådområder',
      'Fosforvådområder og ådale',
    ],
  },
  { label: 'Skovrejsning', color: '#166534', virkemidler: ['Skovrejsning'] },
  {
    label: 'Lavbundsprojekter',
    color: '#b08968',
    virkemidler: ['Lavbundsprojekter'],
  },
]
const MARS_OTHER_COLOR = '#94a3b8'
const marsFillColor = [
  'match',
  ['get', 'virkemiddel'],
  ...MARS_LEGEND.flatMap(({ virkemidler, color }) => [virkemidler, color]),
  MARS_OTHER_COLOR,
] as unknown as ExpressionSpecification

type FarmFieldsMapProps = {
  farm: Farm
  fields: FieldRecord[]
  readOnly?: boolean
  onError: (message: string | null) => void
}

type HoveredField = {
  longitude: number
  latitude: number
  primary: string
  vandopland: string | null
}

type HoveredMars = {
  longitude: number
  latitude: number
  titel: string | null
  virkemiddel: string | null
  status: string | null
  tilskudsordning: string | null
  arealHa: number | null
}

export const FarmFieldsMap = ({
  farm,
  fields,
  readOnly = false,
  onError,
}: FarmFieldsMapProps) => {
  const mapRef = useRef<MapRef>(null)
  const initialViewState =
    savedMapViewStates.get(farm.id) ?? defaultMapViewState
  const hasFitBounds = useRef(savedMapViewStates.has(farm.id))
  const [addMode, setAddMode] = useState(false)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [selectedImkIds, setSelectedImkIds] = useState<number[]>([])
  const [cvrInput, setCvrInput] = useState(farm.cvr ?? '')
  const [highlightedCvr, setHighlightedCvr] = useState<string | null>(null)
  const [highlightedCvrImkIds, setHighlightedCvrImkIds] = useState<number[]>([])
  const [isAttaching, setIsAttaching] = useState(false)
  const [isLoadingCvrFields, setIsLoadingCvrFields] = useState(false)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  const [detachingFieldId, setDetachingFieldId] = useState<string | null>(null)
  const [hoveredField, setHoveredField] = useState<HoveredField | null>(null)
  const [colorBy, setColorBy] = useState<ColorAttribute>('none')
  const [showMars, setShowMars] = useState(false)
  const [hoveredMars, setHoveredMars] = useState<HoveredMars | null>(null)

  const activeColorSpec = colorBy === 'none' ? null : COLOR_SPECS[colorBy]
  const farmThemedColor = activeColorSpec
    ? buildFillColor(activeColorSpec)
    : null
  const registryThemedProperty = activeColorSpec
    ? registryPropertyFor(activeColorSpec)
    : null
  const registryThemedColor =
    activeColorSpec && registryThemedProperty
      ? buildFillColor(activeColorSpec, registryThemedProperty)
      : null
  const isFarmOnlyAttribute = activeColorSpec?.source === 'farm'

  // Zoomed-out dots grow slightly with zoom before handing over to polygons.
  const registryPointRadius: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    registryPointMinZoom,
    2,
    registryPolygonMinZoom,
    5,
  ]

  // Live ("Aktuel") fields are the baseline for the "Ændret sædskifte" scheme.
  // SWR dedupes by key, so this reuses the data already fetched by the page.
  const { data: liveFields = [] } = useFarmFields(farm.id)
  const changedFields = changedFieldIds(fields, liveFields)

  const farmFieldsGeoJson = fieldsToFeatureCollection(fields, changedFields)
  const selectedFarmField = selectedFieldId
    ? fields.find((field) => field.id === selectedFieldId)
    : undefined
  const selectedFarmGeoJson: FeatureCollection = selectedFarmField?.geometry
    ? {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: selectedFarmField.geometry,
        },
      ],
    }
    : emptyFeatureCollection
  const attachedImkIds = fields
    .map((field) => field.imkId)
    .filter((imkId): imkId is number => imkId !== null)
  const selectedRegistryFilter: FilterSpecification =
    selectedImkIds.length > 0
      ? ([
        'in',
        ['get', 'imk_id'],
        ['literal', selectedImkIds],
      ] as FilterSpecification)
      : (['==', ['get', 'imk_id'], -1] as FilterSpecification)
  const highlightedCvrFilter: FilterSpecification = highlightedCvr
    ? ([
      'all',
      ['==', ['get', 'owned'], false],
      ['==', ['get', 'cvr'], highlightedCvr],
    ] as FilterSpecification)
    : (['==', ['get', 'imk_id'], -1] as FilterSpecification)
  const tileParams = new URLSearchParams({
    ownedByFarmId: farm.id,
    fieldVersion: attachedImkIds.join(','),
  })
  if (highlightedCvr) {
    tileParams.set('focusCvr', highlightedCvr)
  }
  const tileUrl = `${window.location.origin}${API_BASE}/registry/tiles/{z}/{x}/{y}.pbf?${tileParams}`
  const marsTileUrl = `${window.location.origin}${API_BASE}/mars/tiles/{z}/{x}/{y}.pbf`

  const saveMapViewState = () => {
    const map = mapRef.current
    if (!map) return

    const center = map.getCenter()
    savedMapViewStates.set(farm.id, {
      longitude: center.lng,
      latitude: center.lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    })
  }

  useEffect(() => {
    if (!isMapLoaded) return
    if (hasFitBounds.current) return

    const bounds = getFieldsBounds(fields)
    if (!bounds) return

    mapRef.current?.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 56, maxZoom: 14, duration: 700 },
    )
    hasFitBounds.current = true
  }, [fields, isMapLoaded])

  const clearSelection = () => {
    setSelectedFieldId(null)
  }

  const toggleAddMode = () => {
    if (readOnly) return

    clearSelection()
    setSelectedImkIds([])
    setHighlightedCvr(null)
    setHighlightedCvrImkIds([])
    if (
      !addMode &&
      isMapLoaded &&
      (mapRef.current?.getZoom() ?? 0) < registryPointMinZoom
    ) {
      mapRef.current?.easeTo({ zoom: registryPointMinZoom, duration: 700 })
    }
    setAddMode((current) => !current)
  }

  const highlightFieldsForCvr = async () => {
    if (readOnly) return

    const cvr = cvrInput.trim()
    if (!/^\d{8}$/.test(cvr)) {
      onError('Indtast et CVR-nummer på 8 cifre for at fremhæve marker.')
      return
    }

    setIsLoadingCvrFields(true)
    try {
      const fieldsForCvr = await fetcher<RegistryFieldSummary[]>(
        `/registry/fields/search?cvr=${encodeURIComponent(cvr)}&limit=500`,
      )
      setHighlightedCvr(cvr)
      setHighlightedCvrImkIds(fieldsForCvr.map((field) => field.imkId))

      if (fieldsForCvr.length > 0) {
        const bounds = await fetcher<RegistryBounds>(
          `/registry/fields/bounds?cvr=${encodeURIComponent(cvr)}`,
        )
        mapRef.current?.fitBounds(
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
          ],
          { padding: 56, maxZoom: 14, duration: 700 },
        )
      }

      onError(null)
    } catch {
      onError('Kunne ikke indlæse marker for det CVR-nummer.')
    } finally {
      setIsLoadingCvrFields(false)
    }
  }

  const selectHighlightedCvrFields = () => {
    const newImkIds = highlightedCvrImkIds.filter(
      (imkId) => !attachedImkIds.includes(imkId),
    )
    setSelectedImkIds((current) =>
      Array.from(new Set([...current, ...newImkIds])),
    )
  }

  const finishAddMode = async () => {
    if (readOnly) return

    if (selectedImkIds.length === 0) {
      toggleAddMode()
      return
    }

    setIsAttaching(true)
    try {
      const registryFieldsKey = registryFieldsBulkKey(selectedImkIds)
      if (!registryFieldsKey) return

      const registryFields = await fetcher<RegistryField[]>(registryFieldsKey)
      const payload: CreateFieldInput[] = registryFields.map((field) => ({
        imkId: field.imkId,
        kystvandId: field.kystvandId,
        retention: field.retention,
        name: field.marknr ?? `Mark ${field.imkId}`,
        areaHa: field.areaHa,
        inTakeoutPlan: field.inTakeoutPlan,
        udledningsgraenseKgnHa: field.udledningsgraenseKgnHa,
        udledningskvoteMarkKgn: field.udledningskvoteMarkKgn,
        geometry: field.geometry,
      }))

      await createFields(farm.id, payload)
      await mutate(farmFieldsKey(farm.id))
      await mutate(farmKey(farm.id))
      setSelectedImkIds([])
      setAddMode(false)
      onError(null)
    } catch {
      onError('Kunne ikke tilføje de valgte marker til bedriften.')
    } finally {
      setIsAttaching(false)
    }
  }

  const handleMapClick = (event: MapLayerMouseEvent) => {
    if (addMode) {
      const candidate = event.features?.find((feature) =>
        [
          'registry-selected-fill',
          'registry-cvr-highlight-fill',
          'registry-candidate-fill',
        ].includes(feature.layer.id),
      )
      const imkId = Number(candidate?.properties?.imk_id)

      if (!Number.isFinite(imkId)) return

      setSelectedImkIds((current) =>
        current.includes(imkId)
          ? current.filter((selectedImkId) => selectedImkId !== imkId)
          : [...current, imkId],
      )

      setSelectedFieldId(null)
      onError(null)
      return
    }

    const farmField = event.features?.find(
      (feature) => feature.layer.id === 'farm-fields-fill',
    )
    const fieldId = farmField?.properties?.fieldId

    if (typeof fieldId !== 'string') return
    setSelectedFieldId(fieldId)
    onError(null)
  }

  const handleMapHover = (event: MapLayerMouseEvent) => {
    const marsFeature = showMars
      ? event.features?.find((item) =>
        ['mars-fill', 'mars-points'].includes(item.layer.id),
      )
      : undefined

    if (marsFeature) {
      mapRef.current?.getCanvas().style.setProperty('cursor', 'pointer')
      setHoveredField(null)
      setHoveredMars({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        titel: (marsFeature.properties?.titel as string | undefined) ?? null,
        virkemiddel:
          (marsFeature.properties?.virkemiddel as string | undefined) ?? null,
        status: (marsFeature.properties?.status as string | undefined) ?? null,
        tilskudsordning:
          (marsFeature.properties?.tilskudsordning as string | undefined) ?? null,
        arealHa:
          typeof marsFeature.properties?.areal_ha === 'number'
            ? marsFeature.properties.areal_ha
            : null,
      })
      return
    }

    setHoveredMars(null)

    const feature = event.features?.find((item) => {
      if (addMode) {
        return [
          'registry-selected-fill',
          'registry-cvr-highlight-fill',
          'registry-candidate-fill',
          'registry-owned-fill',
        ].includes(item.layer.id)
      }

      return item.layer.id === 'farm-fields-fill'
    })

    if (!feature) {
      setHoveredField(null)
      mapRef.current?.getCanvas().style.setProperty('cursor', '')
      return
    }

    const imkId = addMode
      ? feature.properties?.imk_id
      : feature.properties?.imkId
    const marknr = addMode
      ? feature.properties?.marknr
      : null
    const farmName = !addMode ? feature.properties?.name : null
    const kystvandRaw = addMode
      ? feature.properties?.kystvand_id
      : feature.properties?.kystvandId
    const kystvand =
      typeof kystvandRaw === 'number' && Number.isFinite(kystvandRaw)
        ? String(kystvandRaw)
        : typeof kystvandRaw === 'string' && kystvandRaw.length > 0
          ? kystvandRaw
          : null

    const primary =
      typeof farmName === 'string' && farmName.length > 0
        ? farmName
        : typeof marknr === 'string' && marknr.length > 0
          ? `Mark ${marknr}`
          : imkId
            ? `IMK ${imkId}`
            : 'Manuel mark'
    mapRef.current?.getCanvas().style.setProperty('cursor', 'pointer')
    setHoveredField({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
      primary,
      vandopland: kystvand,
    })
  }

  const detachSelectedField = async () => {
    if (!selectedFarmField) return

    setDetachingFieldId(selectedFarmField.id)
    try {
      await detachField(farm.id, selectedFarmField.id)
      await mutate(farmFieldsKey(farm.id))
      await mutate(farmKey(farm.id))
      setSelectedFieldId(null)
      onError(null)
    } catch {
      onError('Kunne ikke fjerne marken fra bedriften.')
    } finally {
      setDetachingFieldId(null)
    }
  }

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden rounded-xl border bg-muted">
      <Map
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        transformRequest={(url) => {
          const token = getAccessToken()
          if (!token || !url.includes('/api/v0/')) return { url }
          return { url, headers: { Authorization: `Bearer ${token}` } }
        }}
        interactiveLayerIds={[
          ...(addMode
            ? [
              'registry-selected-fill',
              'registry-cvr-highlight-fill',
              'registry-candidate-fill',
              'registry-owned-fill',
            ]
            : ['farm-fields-fill']),
          ...(showMars ? ['mars-fill', 'mars-points'] : []),
        ]}
        onLoad={() => setIsMapLoaded(true)}
        onMoveEnd={saveMapViewState}
        onClick={handleMapClick}
        onMouseMove={handleMapHover}
        onMouseLeave={() => {
          setHoveredField(null)
          setHoveredMars(null)
          mapRef.current?.getCanvas().style.setProperty('cursor', '')
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <Source id="farm-fields" type="geojson" data={farmFieldsGeoJson}>
          <Layer
            id="farm-fields-fill"
            type="fill"
            paint={{
              'fill-color': farmThemedColor ?? '#16a34a',
              'fill-opacity': addMode ? 0.28 : farmThemedColor ? 0.7 : 0.5,
            }}
          />
          <Layer
            id="farm-fields-outline"
            type="line"
            paint={{
              'line-color': '#15803d',
              'line-width': 1.8,
              'line-opacity': 0.9,
            }}
          />
        </Source>

        {addMode ? (
          <Source
            key={tileUrl}
            id="registry-fields"
            type="vector"
            tiles={[tileUrl]}
            minzoom={registryPointMinZoom}
            maxzoom={16}
          >
            <Layer
              id="registry-points-candidate"
              source-layer="fields"
              type="circle"
              minzoom={registryPointMinZoom}
              maxzoom={registryPolygonMinZoom}
              filter={['==', ['get', 'owned'], false] as FilterSpecification}
              paint={{
                'circle-color': registryThemedColor ?? '#64748b',
                'circle-opacity': 0.85,
                'circle-radius': registryPointRadius,
              }}
            />
            <Layer
              id="registry-points-cvr-highlight"
              source-layer="fields"
              type="circle"
              minzoom={registryPointMinZoom}
              maxzoom={registryPolygonMinZoom}
              filter={highlightedCvrFilter}
              paint={{
                'circle-color': '#facc15',
                'circle-radius': registryPointRadius,
                'circle-stroke-color': '#ca8a04',
                'circle-stroke-width': 0.8,
              }}
            />
            <Layer
              id="registry-points-owned"
              source-layer="fields"
              type="circle"
              minzoom={registryPointMinZoom}
              maxzoom={registryPolygonMinZoom}
              filter={['==', ['get', 'owned'], true] as FilterSpecification}
              paint={{
                'circle-color': registryThemedColor ?? '#16a34a',
                'circle-opacity': 0.9,
                'circle-radius': registryPointRadius,
                'circle-stroke-color': '#1f2937',
                'circle-stroke-width': 0.8,
              }}
            />
            <Layer
              id="registry-candidate-fill"
              source-layer="fields"
              type="fill"
              minzoom={registryPolygonMinZoom}
              filter={['==', ['get', 'owned'], false] as FilterSpecification}
              paint={{
                'fill-color': registryThemedColor ?? '#64748b',
                'fill-opacity': registryThemedColor ? 0.6 : 0.3,
              }}
            />
            <Layer
              id="registry-candidate-outline"
              source-layer="fields"
              type="line"
              minzoom={registryPolygonMinZoom}
              filter={['==', ['get', 'owned'], false] as FilterSpecification}
              paint={{
                'line-color': '#475569',
                'line-width': 1,
                'line-opacity': 0.7,
              }}
            />
            <Layer
              id="registry-cvr-highlight-fill"
              source-layer="fields"
              type="fill"
              minzoom={registryPolygonMinZoom}
              filter={highlightedCvrFilter}
              paint={{ 'fill-color': '#facc15', 'fill-opacity': 0.48 }}
            />
            <Layer
              id="registry-cvr-highlight-outline"
              source-layer="fields"
              type="line"
              minzoom={registryPolygonMinZoom}
              filter={highlightedCvrFilter}
              paint={{
                'line-color': '#ca8a04',
                'line-width': 1.8,
                'line-opacity': 0.9,
              }}
            />
            <Layer
              id="registry-selected-fill"
              source-layer="fields"
              type="fill"
              minzoom={registryPolygonMinZoom}
              filter={selectedRegistryFilter}
              paint={{ 'fill-color': '#2563eb', 'fill-opacity': 0.55 }}
            />
            <Layer
              id="registry-selected-outline"
              source-layer="fields"
              type="line"
              minzoom={registryPolygonMinZoom}
              filter={selectedRegistryFilter}
              paint={{
                'line-color': '#1d4ed8',
                'line-width': 2.5,
                'line-opacity': 0.95,
              }}
            />
            <Layer
              id="registry-owned-fill"
              source-layer="fields"
              type="fill"
              minzoom={registryPolygonMinZoom}
              filter={['==', ['get', 'owned'], true] as FilterSpecification}
              paint={{
                'fill-color': registryThemedColor ?? '#64748b',
                'fill-opacity': registryThemedColor ? 0.55 : 0.2,
              }}
            />
            <Layer
              id="registry-owned-outline"
              source-layer="fields"
              type="line"
              minzoom={registryPolygonMinZoom}
              filter={['==', ['get', 'owned'], true] as FilterSpecification}
              paint={{
                'line-color': '#475569',
                'line-width': 0.8,
                'line-opacity': 0.5,
              }}
            />
          </Source>
        ) : null}

        {showMars ? (
          <Source
            key={marsTileUrl}
            id="mars-projekter"
            type="vector"
            tiles={[marsTileUrl]}
            maxzoom={16}
          >
            <Layer
              id="mars-points"
              source-layer="mars"
              type="circle"
              maxzoom={marsPolygonMinZoom}
              paint={{
                'circle-color': marsFillColor,
                'circle-opacity': 0.85,
                'circle-radius': registryPointRadius,
              }}
            />
            <Layer
              id="mars-fill"
              source-layer="mars"
              type="fill"
              minzoom={marsPolygonMinZoom}
              paint={{ 'fill-color': marsFillColor, 'fill-opacity': 0.45 }}
            />
            <Layer
              id="mars-outline"
              source-layer="mars"
              type="line"
              minzoom={marsPolygonMinZoom}
              paint={{
                'line-color': marsFillColor,
                'line-width': 1.5,
                'line-opacity': 0.9,
              }}
            />
          </Source>
        ) : null}

        <Source
          id="selected-farm-field"
          type="geojson"
          data={selectedFarmGeoJson}
        >
          <Layer
            id="selected-farm-field-fill"
            type="fill"
            paint={{ 'fill-color': '#2563eb', 'fill-opacity': 0.2 }}
          />
          <Layer
            id="selected-farm-field-outline"
            type="line"
            paint={{ 'line-color': '#1d4ed8', 'line-width': 3 }}
          />
        </Source>

        {hoveredField ? (
          <Popup
            longitude={hoveredField.longitude}
            latitude={hoveredField.latitude}
            closeButton={false}
            closeOnClick={false}
            anchor="top"
            offset={8}
          >
            <div className="flex flex-col gap-0.5 text-xs">
              <span className="font-medium">{hoveredField.primary}</span>
              <span className="text-muted-foreground">
                {hoveredField.vandopland !== null
                  ? `Vandopland ${hoveredField.vandopland}`
                  : 'Vandopland ukendt'}
              </span>
            </div>
          </Popup>
        ) : null}

        {hoveredMars ? (
          <Popup
            longitude={hoveredMars.longitude}
            latitude={hoveredMars.latitude}
            closeButton={false}
            closeOnClick={false}
            anchor="top"
            offset={8}
          >
            <div className="flex flex-col gap-0.5 text-xs">
              <span className="font-medium">
                {hoveredMars.titel ?? 'MARS-projekt'}
              </span>
              {hoveredMars.virkemiddel ? (
                <span>{hoveredMars.virkemiddel}</span>
              ) : null}
              {hoveredMars.tilskudsordning ? (
                <span className="text-muted-foreground">
                  {hoveredMars.tilskudsordning}
                </span>
              ) : null}
              <span className="text-muted-foreground">
                {hoveredMars.status ?? 'Status ukendt'}
                {hoveredMars.arealHa !== null
                  ? ` · ${formatNumber(hoveredMars.arealHa)} ha`
                  : ''}
              </span>
            </div>
          </Popup>
        ) : null}
      </Map>

      <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm">
        {!readOnly ? (
          <Button
            onClick={() => void (addMode ? finishAddMode() : toggleAddMode())}
            size="sm"
            variant={addMode ? 'default' : 'outline'}
            disabled={isAttaching}
          >
            {addMode && selectedImkIds.length > 0
              ? isAttaching
                ? 'Tilføjer...'
                : `Tilføj ${selectedImkIds.length} ${selectedImkIds.length === 1 ? 'mark' : 'marker'}`
              : addMode
                ? 'Færdig'
                : 'Tilføj marker'}
          </Button>
        ) : null}
        <span
          className={`${readOnly ? '' : 'hidden sm:inline'} text-xs text-muted-foreground`}
        >
          {addMode
            ? 'Klik på registermarker for at vælge eller fravælge dem.'
            : readOnly
              ? 'Klik på en simuleringsmark for at gennemgå den.'
              : 'Klik på en tilknyttet mark for at gennemgå den.'}
        </span>
      </div>

      {addMode ? (
        <Card className="absolute right-4 top-4 z-10 w-[min(20rem,calc(100%-2rem))] bg-background/95 shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle>{selectedImkIds.length} valgt</CardTitle>
            <CardDescription>Blå marker tilføjes samlet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-2 rounded-md border bg-background/80 p-3">
              <p className="font-medium">CVR-fremhævelse</p>
              <Input
                value={cvrInput}
                inputMode="numeric"
                placeholder="12345678"
                onChange={(event) => setCvrInput(event.target.value)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void highlightFieldsForCvr()}
                  disabled={isLoadingCvrFields}
                >
                  {isLoadingCvrFields ? 'Indlæser...' : 'Fremhæv marker'}
                </Button>
                <Button
                  size="sm"
                  onClick={selectHighlightedCvrFields}
                  disabled={
                    !highlightedCvr || highlightedCvrImkIds.length === 0
                  }
                >
                  Tilføj marker for CVR
                </Button>
              </div>
              {highlightedCvr ? (
                <p className="text-xs text-muted-foreground">
                  Fremhæver {highlightedCvrImkIds.length}{' '}
                  {highlightedCvrImkIds.length === 1 ? 'mark' : 'marker'} for
                  CVR {highlightedCvr}.
                </p>
              ) : null}
            </div>
            {selectedImkIds.length > 0 ? (
              <p className="text-muted-foreground">
                {selectedImkIds.length}{' '}
                {selectedImkIds.length === 1 ? 'mark' : 'marker'} valgt til
                tilføjelse.
              </p>
            ) : (
              <p className="text-muted-foreground">
                Klik på grå eller gule registermarker for at vælge dem.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => void finishAddMode()}
                disabled={isAttaching || selectedImkIds.length === 0}
              >
                {isAttaching ? 'Tilføjer...' : 'Tilføj valgte'}
              </Button>
              <Button
                variant="outline"
                onClick={toggleAddMode}
                disabled={isAttaching}
              >
                Annuller
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {selectedFarmField ? (
        <Card className="absolute right-4 top-4 z-10 w-[min(20rem,calc(100%-2rem))] bg-background/95 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{selectedFarmField.name}</CardTitle>
                <CardDescription>
                  {selectedFarmField.imkId
                    ? `IMK ${selectedFarmField.imkId}`
                    : 'Manuel mark'}
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={clearSelection}>
                Luk
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {(() => {
                const areaHa = selectedFarmField.areaHa
                const perHa = (raw: number, unit: string) =>
                  areaHa > 0
                    ? `${formatNumber(raw / areaHa)} ${unit}`
                    : undefined
                return (
                  <>
                    <FieldStat
                      label="Areal"
                      value={`${formatNumber(areaHa)} ha`}
                    />
                    <FieldStat
                      label="Retention"
                      value={
                        selectedFarmField.retention === null
                          ? 'Ukendt'
                          : formatNumber(selectedFarmField.retention)
                      }
                    />
                    <FieldStat
                      label="JB nr."
                      value={
                        selectedFarmField.jbnr === null
                          ? 'Ukendt'
                          : String(selectedFarmField.jbnr)
                      }
                    />
                    <FieldStat
                      label="Sædskifte"
                      value={formatRealRotation(selectedFarmField.cropRotation)}
                    />
                    <FieldStat
                      label="DB2"
                      value={`${formatNumber(selectedFarmField.db2)} kr`}
                      subValue={perHa(selectedFarmField.db2, 'kr/ha')}
                    />
                    <FieldStat
                      label="Udledning"
                      value={`${formatNumber(selectedFarmField.nLoad)} kg N`}
                      subValue={perHa(selectedFarmField.nLoad, 'kg N/ha')}
                    />
                    <FieldStat
                      label="Udvaskning"
                      value={`${formatNumber(selectedFarmField.leaching)} kg N`}
                      subValue={perHa(selectedFarmField.leaching, 'kg N/ha')}
                    />
                    <FieldStat
                      label="Indgår i omlægningsplan"
                      value={selectedFarmField.inTakeoutPlan}
                    />
                    <FieldStat
                      label="Udledningskvote"
                      value={`${formatNumber(selectedFarmField.udledningskvoteMarkKgn)} kg N`}
                      subValue={perHa(selectedFarmField.udledningskvoteMarkKgn, 'kg N/ha')}
                    />
                  </>
                )
              })()}
            </div>
            {!readOnly ? (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => void detachSelectedField()}
                disabled={detachingFieldId === selectedFarmField.id}
              >
                {detachingFieldId === selectedFarmField.id
                  ? 'Fjerner...'
                  : 'Fjern mark'}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="absolute bottom-4 left-4 z-10 w-[min(18rem,calc(100%-2rem))] bg-background/95 shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Farvelæg marker</CardTitle>
          <CardDescription>
            Vælg en variabel at visualisere på kortet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={colorBy}
            onChange={(event) =>
              setColorBy(event.target.value as ColorAttribute)
            }
          >
            {ATTRIBUTE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {activeColorSpec ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Legende
                {activeColorSpec.unit ? ` (${activeColorSpec.unit})` : ''}
              </p>
              <ul className="space-y-1">
                {legendEntries(activeColorSpec).map((entry) => (
                  <li
                    key={entry.label}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="inline-block h-3 w-4 flex-shrink-0 rounded-sm border border-black/10"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span>{entry.label}</span>
                  </li>
                ))}
              </ul>
              {isFarmOnlyAttribute ? (
                <p className="text-xs italic text-muted-foreground">
                  Vises kun for tilknyttede marker.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showMars}
                onChange={(event) => setShowMars(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Grøn Trepart - Omlægningsplan
            </label>
            {showMars ? (
              <ul className="space-y-1 pl-6">
                {[
                  ...MARS_LEGEND,
                  { label: 'Andet', color: MARS_OTHER_COLOR, virkemidler: [] },
                ].map((entry) => (
                  <li
                    key={entry.label}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="inline-block h-3 w-4 flex-shrink-0 rounded-sm border border-black/10"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span>{entry.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

type FieldStatProps = {
  label: string
  value: string | number
  subValue?: string
}

const FieldStat = ({ label, value, subValue }: FieldStatProps) => (
  <div className="rounded-md bg-muted/70 p-3">
    <p className="text-muted-foreground">{label}</p>
    <p className="mt-1 break-words font-medium">{value}</p>
    {subValue ? (
      <p className="mt-0.5 text-xs text-muted-foreground/80">{subValue}</p>
    ) : null}
  </div>
)
