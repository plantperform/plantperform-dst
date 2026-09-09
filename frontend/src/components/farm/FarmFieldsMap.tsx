import 'maplibre-gl/dist/maplibre-gl.css'

import type { FeatureCollection } from 'geojson'
import { Lock } from 'lucide-react'
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import Map, {
  Layer,
  Marker,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import { mutate } from 'swr'

import { getAccessToken } from '@/api/auth'
import { API_BASE, fetcher } from '@/api/client'
import {
  farmFieldsKey,
  farmKey,
  registryFieldsBulkKey,
  useFarmFields,
  type SimulationFieldYearValues,
} from '@/api/hooks'
import { createFields } from '@/api/mutations'
import type {
  CreateFieldInput,
  Farm,
  FieldRecord,
  RegistryBounds,
  RegistryField,
  RegistryFieldSummary,
} from '@/api/types'
import type { FarmInspectorMode } from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  changedFieldIds,
  formatFieldCount,
  isFieldLocked,
  ROTATION_START_CALENDAR_YEAR,
  yearNLoadKgHa,
} from '@/lib/field-domain'
import {
  clusterByPixelDistance,
  fieldLabelPoint,
  fieldsToFeatureCollection,
  getFieldsBounds,
  type FieldYearProperties,
} from '@/lib/geo'
import { cn } from '@/lib/utils'
import {
  cropGroupColor,
  readableTextColor,
  shortCropName,
} from '@/lib/crop-groups'
import {
  ATTRIBUTE_OPTIONS,
  COLOR_SPECS,
  HOVER_FIELD_FILL_COLOR,
  HOVER_FIELD_LINE_COLOR,
  buildFillColor,
  buildYearCropSpec,
  isYearColorAttribute,
  legendEntries,
  registryPropertyFor,
  yearQuotaStatusLabel,
  type ColorAttribute,
  type ColorSpec,
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
const CROP_LABEL_MIN_ZOOM = 12
const CROP_LABEL_CLUSTER_PX = 48
const VIEWPORT_INSET_FRACTION = 0.1
const defaultMapViewState = { longitude: 10.1, latitude: 56.1, zoom: 7 }
const paintTransitionMs = window.matchMedia('(prefers-reduced-motion: reduce)')
  .matches
  ? 0
  : 300

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
  mode?: FarmInspectorMode
  selectedYearIndex?: number | null
  yearValues?: SimulationFieldYearValues
  yearValuesLoading?: boolean
  selectedFieldId: string | null
  onSelectedFieldChange: (fieldId: string | null) => void
  hoveredFieldId: string | null
  onHoveredFieldChange: (fieldId: string | null) => void
  zoomRequest?: { fieldId: string; nonce: number }
  onError: (message: string | null) => void
}

const describeYearQuotaStatus = (status: number | null): string => {
  const label = yearQuotaStatusLabel(status)
  if (label === null) return ''
  return ` - ${label.charAt(0).toLowerCase()}${label.slice(1)}`
}

const defaultColorByForMode = (mode: FarmInspectorMode): ColorAttribute =>
  mode === 'rules' ? 'fieldLocked' : 'none'

type ColorBySelection = {
  forMode: FarmInspectorMode
  value: ColorAttribute
}

type HoveredField = {
  longitude: number
  latitude: number
  primary: string
  vandopland: string | null
  hasRotation: boolean
  yearCrop: string | null
  yearNLoadKgHa: number | null
  yearQuotaStatus: number | null
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
  mode = 'values',
  selectedYearIndex = null,
  yearValues,
  yearValuesLoading = false,
  selectedFieldId,
  onSelectedFieldChange,
  hoveredFieldId,
  onHoveredFieldChange,
  zoomRequest,
  onError,
}: FarmFieldsMapProps) => {
  const mapRef = useRef<MapRef>(null)
  const initialViewState =
    savedMapViewStates.get(farm.id) ?? defaultMapViewState
  const hasFitBounds = useRef(savedMapViewStates.has(farm.id))
  const hoverFrame = useRef<number | null>(null)
  const pendingHoveredFieldId = useRef<string | null>(null)
  const reportedHoveredFieldId = useRef<string | null>(null)
  const pannedFieldId = useRef<string | null>(null)
  const appliedZoomNonce = useRef<number | null>(zoomRequest?.nonce ?? null)
  const [addMode, setAddMode] = useState(false)
  const [selectedImkIds, setSelectedImkIds] = useState<number[]>([])
  const [cvrInput, setCvrInput] = useState(farm.cvr ?? '')
  const [highlightedCvr, setHighlightedCvr] = useState<string | null>(null)
  const [highlightedCvrImkIds, setHighlightedCvrImkIds] = useState<number[]>([])
  const [isAttaching, setIsAttaching] = useState(false)
  const [isLoadingCvrFields, setIsLoadingCvrFields] = useState(false)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  const [hoveredField, setHoveredField] = useState<HoveredField | null>(null)
  const [colorBySelection, setColorBySelection] = useState<ColorBySelection>(
    () => ({ forMode: mode, value: defaultColorByForMode(mode) }),
  )
  const [previousHasSelectedYear, setPreviousHasSelectedYear] = useState(false)
  const [colorByBeforeYear, setColorByBeforeYear] =
    useState<ColorAttribute | null>(null)
  const hasSelectedYear = mode !== 'rules' && selectedYearIndex !== null
  const yearIndex = hasSelectedYear ? selectedYearIndex : null
  const selectedCalendarYear =
    yearIndex !== null ? ROTATION_START_CALENDAR_YEAR + yearIndex : null
  const colorBy =
    colorBySelection.forMode === mode
      ? colorBySelection.value
      : defaultColorByForMode(mode)
  if (previousHasSelectedYear !== hasSelectedYear) {
    setPreviousHasSelectedYear(hasSelectedYear)
    if (hasSelectedYear) {
      setColorByBeforeYear(isYearColorAttribute(colorBy) ? null : colorBy)
      setColorBySelection({ forMode: mode, value: 'yearNLoad' })
    } else {
      if (isYearColorAttribute(colorBy)) {
        setColorBySelection({
          forMode: mode,
          value: colorByBeforeYear ?? 'none',
        })
      }
      setColorByBeforeYear(null)
    }
  }
  const setColorBy = (value: ColorAttribute) =>
    setColorBySelection({ forMode: mode, value })
  const showLockMarkers = mode === 'rules' || colorBy === 'fieldLocked'
  const [showMars, setShowMars] = useState(false)
  const [showCropLabels, setShowCropLabels] = useState(true)
  const [mapZoom, setMapZoom] = useState(initialViewState.zoom)
  const [hoveredMars, setHoveredMars] = useState<HoveredMars | null>(null)

  const yearCropSpec = useMemo(
    () =>
      yearIndex === null
        ? null
        : buildYearCropSpec(
            fields.flatMap((field) => {
              const year = field.cropRotation[yearIndex]
              return year ? [year] : []
            }),
          ),
    [fields, yearIndex],
  )
  const colorOptions = hasSelectedYear
    ? ATTRIBUTE_OPTIONS
    : ATTRIBUTE_OPTIONS.filter((option) => !isYearColorAttribute(option.value))

  const activeColorSpec: ColorSpec | null =
    colorBy === 'none'
      ? null
      : colorBy === 'yearCrop'
        ? yearCropSpec
        : COLOR_SPECS[colorBy]
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
  const changedFields = useMemo(
    () => changedFieldIds(fields, liveFields),
    [fields, liveFields],
  )

  const yearProperties = useMemo((): FieldYearProperties | undefined => {
    if (yearIndex === null) return undefined
    const nLoadKgHaByFieldId: Record<string, number> = {}
    for (const field of fields) {
      const yearResult = yearValues?.[field.id]?.[yearIndex]
      if (!yearResult) continue
      nLoadKgHaByFieldId[field.id] = yearNLoadKgHa(
        yearResult.leachingKgNHa,
        field.retention,
      )
    }
    return { yearIndex, nLoadKgHaByFieldId }
  }, [fields, yearValues, yearIndex])
  const yearValuesFieldCount = yearProperties
    ? Object.keys(yearProperties.nLoadKgHaByFieldId).length
    : 0
  const rotationFieldCount = fields.filter(
    (field) => field.rotationId !== null,
  ).length

  const farmFieldsGeoJson = useMemo(
    () => fieldsToFeatureCollection(fields, changedFields, yearProperties),
    [fields, changedFields, yearProperties],
  )
  const lockedFieldMarkers = useMemo(
    () =>
      fields
        .filter(isFieldLocked)
        .map((field) => ({ field, point: fieldLabelPoint(field) }))
        .filter(
          (entry): entry is { field: FieldRecord; point: [number, number] } =>
            entry.point !== null,
        ),
    [fields],
  )
  const cropLabelMarkers = useMemo(() => {
    if (yearIndex === null) return []
    const labels = fields.flatMap((field) => {
      const year = field.cropRotation[yearIndex]
      const point = fieldLabelPoint(field)
      if (!year || point === null) return []
      return [
        {
          field,
          point,
          name: shortCropName(year.afgrodeNavn),
          fullName: year.afgrodeNavn,
          color: cropGroupColor(year.afgrodeKode, year.afgrodeNavn),
        },
      ]
    })
    return clusterByPixelDistance(
      labels,
      (label) => label.point,
      mapZoom,
      CROP_LABEL_CLUSTER_PX,
    ).map((cluster) => {
      const names = new Set(cluster.items.map((label) => label.name))
      const first = cluster.items[0]
      const sameCrop = names.size === 1
      const count = cluster.items.length
      const color = sameCrop ? first.color : null
      return {
        key: cluster.items.map((label) => label.field.id).join('+'),
        point: cluster.center,
        label:
          count === 1
            ? first.name
            : sameCrop
              ? `${first.name} · ${formatFieldCount(count)}`
              : formatFieldCount(count),
        title: cluster.items
          .map((label) => `${label.field.name}: ${label.fullName}`)
          .join(', '),
        color,
        textColor: color ? readableTextColor(color) : null,
      }
    })
  }, [fields, yearIndex, mapZoom])
  const cropLabelsVisible =
    showCropLabels && yearIndex !== null && mapZoom >= CROP_LABEL_MIN_ZOOM
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
  const hoveredFarmField =
    hoveredFieldId !== null && hoveredFieldId !== selectedFieldId
      ? fields.find((field) => field.id === hoveredFieldId)
      : undefined
  const hoverFarmGeoJson: FeatureCollection = hoveredFarmField?.geometry
    ? {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: hoveredFarmField.geometry,
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
    setMapZoom(map.getZoom())
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
    pannedFieldId.current = selectedFieldId
  }, [fields, isMapLoaded, selectedFieldId])

  useEffect(
    () => () => {
      if (hoverFrame.current !== null) {
        window.cancelAnimationFrame(hoverFrame.current)
        hoverFrame.current = null
      }
      if (reportedHoveredFieldId.current !== null) {
        reportedHoveredFieldId.current = null
        onHoveredFieldChange(null)
      }
    },
    [onHoveredFieldChange],
  )

  useEffect(() => {
    if (!isMapLoaded) return
    if (pannedFieldId.current === selectedFieldId) return
    if (selectedFieldId === null) {
      pannedFieldId.current = null
      return
    }

    const field = fields.find((item) => item.id === selectedFieldId)
    const map = mapRef.current
    if (!field || !map) return
    pannedFieldId.current = selectedFieldId

    const bounds = getFieldsBounds([field])
    if (!bounds) return

    const viewport = map.getBounds()
    const west = viewport.getWest()
    const east = viewport.getEast()
    const south = viewport.getSouth()
    const north = viewport.getNorth()
    const insetX = (east - west) * VIEWPORT_INSET_FRACTION
    const insetY = (north - south) * VIEWPORT_INSET_FRACTION
    const isVisible =
      bounds[0] <= east - insetX &&
      bounds[2] >= west + insetX &&
      bounds[1] <= north - insetY &&
      bounds[3] >= south + insetY
    if (isVisible) return

    map.easeTo({
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      duration: 500,
    })
  }, [fields, isMapLoaded, selectedFieldId])

  useEffect(() => {
    if (!isMapLoaded || !zoomRequest) return
    if (appliedZoomNonce.current === zoomRequest.nonce) return

    const field = fields.find((item) => item.id === zoomRequest.fieldId)
    if (!field) return

    const bounds = getFieldsBounds([field])
    if (!bounds) return

    appliedZoomNonce.current = zoomRequest.nonce
    pannedFieldId.current = zoomRequest.fieldId
    mapRef.current?.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 64, maxZoom: 16, duration: 500 },
    )
  }, [fields, isMapLoaded, zoomRequest])

  const reportHoveredField = (fieldId: string | null) => {
    pendingHoveredFieldId.current = fieldId
    if (fieldId === null) {
      if (hoverFrame.current !== null) {
        window.cancelAnimationFrame(hoverFrame.current)
        hoverFrame.current = null
      }
      reportedHoveredFieldId.current = null
      onHoveredFieldChange(null)
      return
    }
    if (hoverFrame.current !== null) return
    hoverFrame.current = window.requestAnimationFrame(() => {
      hoverFrame.current = null
      reportedHoveredFieldId.current = pendingHoveredFieldId.current
      onHoveredFieldChange(pendingHoveredFieldId.current)
    })
  }

  const toggleAddMode = () => {
    if (readOnly) return

    onSelectedFieldChange(null)
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

      onSelectedFieldChange(null)
      onError(null)
      return
    }

    const farmField = event.features?.find(
      (feature) => feature.layer.id === 'farm-fields-fill',
    )
    const fieldId = farmField?.properties?.fieldId
    const clickedFieldId = typeof fieldId === 'string' ? fieldId : null

    pannedFieldId.current = clickedFieldId
    onSelectedFieldChange(clickedFieldId)
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
      reportHoveredField(null)
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
      reportHoveredField(null)
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
    const yearCropRaw = addMode ? null : feature.properties?.yearAfgrodeNavn
    const yearNLoadRaw = addMode ? null : feature.properties?.yearNLoadKgHa
    const yearQuotaStatusRaw = addMode
      ? null
      : feature.properties?.yearQuotaStatus
    const hoveredFarmFieldId = addMode ? null : feature.properties?.fieldId
    const hasRotation =
      typeof hoveredFarmFieldId === 'string' &&
      fields.some(
        (field) => field.id === hoveredFarmFieldId && field.rotationId !== null,
      )
    mapRef.current?.getCanvas().style.setProperty('cursor', 'pointer')
    reportHoveredField(
      typeof hoveredFarmFieldId === 'string' ? hoveredFarmFieldId : null,
    )
    setHoveredField({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
      primary,
      vandopland: kystvand,
      hasRotation,
      yearCrop:
        typeof yearCropRaw === 'string' && yearCropRaw.length > 0
          ? yearCropRaw
          : null,
      yearNLoadKgHa:
        typeof yearNLoadRaw === 'number' && Number.isFinite(yearNLoadRaw)
          ? yearNLoadRaw
          : null,
      yearQuotaStatus:
        typeof yearQuotaStatusRaw === 'number' ? yearQuotaStatusRaw : null,
    })
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted">
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
          reportHoveredField(null)
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
              'fill-opacity-transition': { duration: paintTransitionMs },
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

        <Source id="hover-farm-field" type="geojson" data={hoverFarmGeoJson}>
          <Layer
            id="hover-farm-field-fill"
            type="fill"
            paint={{
              'fill-color': HOVER_FIELD_FILL_COLOR,
              'fill-opacity': 0.15,
            }}
          />
          <Layer
            id="hover-farm-field-outline"
            type="line"
            paint={{
              'line-color': HOVER_FIELD_LINE_COLOR,
              'line-width': 2,
              'line-opacity': 0.9,
            }}
          />
        </Source>

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

        {showLockMarkers
          ? lockedFieldMarkers.map(({ field, point }) => (
            <Marker
              key={`lock-${field.id}`}
              longitude={point[0]}
              latitude={point[1]}
              anchor="center"
              style={{ pointerEvents: 'none' }}
            >
              <span
                role="img"
                aria-label={`Låst mark ${field.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-300 bg-white/95 shadow-md"
              >
                <Lock
                  className="h-4 w-4 text-amber-600"
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
              </span>
            </Marker>
          ))
          : null}
        {cropLabelsVisible
          ? cropLabelMarkers.map((marker) => (
            <Marker
              key={`crop-${marker.key}`}
              longitude={marker.point[0]}
              latitude={marker.point[1]}
              anchor="top"
              offset={[0, 4]}
              style={{ pointerEvents: 'none' }}
            >
              <span
                role="img"
                aria-label={marker.title}
                title={marker.title}
                className={cn(
                  'block max-w-40 truncate rounded-full px-2 py-0.5 text-xs font-medium shadow-md outline-1 -outline-offset-1 outline-black/10',
                  marker.color === null && 'bg-background text-foreground',
                )}
                style={
                  marker.color !== null
                    ? { backgroundColor: marker.color, color: marker.textColor ?? undefined }
                    : undefined
                }
              >
                {marker.label}
              </span>
            </Marker>
          ))
          : null}

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
              {selectedCalendarYear !== null ? (
                <>
                  <span>
                    {selectedCalendarYear}:{' '}
                    {hoveredField.yearCrop ?? 'ingen afgrøde for året'}
                  </span>
                  <span className="text-muted-foreground">
                    {hoveredField.yearNLoadKgHa !== null
                      ? `Udledning ${formatNumber(hoveredField.yearNLoadKgHa)} kg N/ha${describeYearQuotaStatus(hoveredField.yearQuotaStatus)}`
                      : yearValuesLoading
                        ? 'Henter udledning for året...'
                        : hoveredField.hasRotation
                          ? 'Uden for markens rotationscyklus'
                          : 'Ingen udledning beregnet for året'}
                  </span>
                </>
              ) : null}
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
            : mode === 'rules'
              ? 'Låste marker er markeret med hængelås. Skift til Liste for at ændre regler.'
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
            {colorOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {selectedCalendarYear !== null && yearValuesLoading ? (
            <p role="status" className="text-xs text-muted-foreground">
              Henter årstal for markerne...
            </p>
          ) : selectedCalendarYear !== null &&
            yearValuesFieldCount < rotationFieldCount ? (
            <p role="status" className="text-xs text-muted-foreground">
              {yearValuesFieldCount} af {rotationFieldCount} marker har årstal
              for {selectedCalendarYear}
            </p>
          ) : null}

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

          {hasSelectedYear ? (
            <div className="space-y-1 border-t pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showCropLabels}
                  onChange={(event) => setShowCropLabels(event.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Vis afgrødenavne for {selectedCalendarYear}
              </label>
              {showCropLabels && mapZoom < CROP_LABEL_MIN_ZOOM ? (
                <p className="pl-6 text-xs text-muted-foreground">
                  Zoom ind for at se navnene.
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
