import 'maplibre-gl/dist/maplibre-gl.css'

import type { FeatureCollection } from 'geojson'
import { Layers, Lock, Maximize, X } from 'lucide-react'
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'

import { getAccessToken } from '@/api/auth'
import { API_BASE, fetcher } from '@/api/client'
import { useFarmFields } from '@/api/hooks'
import { importRegistryFields } from '@/api/mutations'
import type {
  FieldYearValues,
  Farm,
  FieldRecord,
  RegistryBounds,
  RegistryFieldSummary,
} from '@/api/types'
import {
  catchmentKey,
  fieldInCatchment,
  useCatchmentLabel,
} from '@/components/farm/catchment-options'
import { refreshFarmFields } from '@/components/farm/detach-fields'
import { FieldRowList, type FieldRow } from '@/components/farm/FieldRowList'
import {
  FieldTooltip,
  type HoveredField,
} from '@/components/farm/FieldTooltip'
import { MapRuleCard } from '@/components/farm/MapRuleCard'
import type { FarmInspectorMode } from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  changedFieldIds,
  fieldTitle,
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
import { useEscapeKey } from '@/hooks/use-escape-key'
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
  buildCatchmentFillOpacity,
  buildFillColor,
  buildYearCropSpec,
  formatLegendUnit,
  isYearColorAttribute,
  legendEntries,
  registryPropertyFor,
  toFiniteNumber,
  type ColorAttribute,
  type ColorSpec,
} from '@/lib/map-coloring'

const formatNumber = (value: number) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 }).format(value)

const emptyFeatureCollection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}
type SelectedRegistryField = {
  imkId: number
  label: string
  areaHa: number | null
}

const registryFieldLabel = (imkId: number, fieldNumber: unknown) =>
  typeof fieldNumber === 'string' && fieldNumber.length > 0
    ? `Mark ${fieldNumber}`
    : `IMK ${imkId}`

const describeFarmAfterChanges = (
  fieldCount: number,
  nextFieldCount: number,
  areaChangeHa: number,
) => {
  const count =
    nextFieldCount === fieldCount
      ? `Bedriften bliver på ${formatFieldCount(fieldCount)}`
      : `Bedriften går fra ${fieldCount} til ${formatFieldCount(nextFieldCount)}`
  const area =
    areaChangeHa === 0
      ? ''
      : `, ${areaChangeHa < 0 ? '-' : '+'}${formatNumber(Math.abs(areaChangeHa))} ha`
  return `${count}${area}`
}

const REGISTRY_CANDIDATE_LAYER_IDS = [
  'registry-selected-fill',
  'registry-cvr-highlight-fill',
  'registry-candidate-fill',
]

const EDIT_MODE_LAYER_IDS = [
  ...REGISTRY_CANDIDATE_LAYER_IDS,
  'registry-owned-fill',
  'farm-fields-fill',
]

const EDIT_BASE_LEGEND = [
  { label: 'Bedriftens marker', color: 'rgba(22, 163, 74, 0.28)' },
  { label: 'Registermarker', color: 'rgba(100, 116, 139, 0.3)' },
]

const EDIT_CHANGE_LEGEND = [
  { label: 'Tilføjes', color: 'rgba(37, 99, 235, 0.55)' },
  { label: 'Fjernes', color: 'rgba(220, 38, 38, 0.5)' },
]

const CVR_LEGEND_ENTRY = { label: 'Fremhævet CVR', color: 'rgba(250, 204, 21, 0.48)' }

const registryPointMinZoom = 6
const registryPolygonMinZoom = 11
const marsPolygonMinZoom = 11
const CROP_LABEL_MIN_ZOOM = 12
const CROP_LABEL_CLUSTER_PX = 48
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
const MARS_LEGEND: { label: string; color: string; measures: string[] }[] = [
  {
    label: 'Vådområder',
    color: '#7c3aed',
    measures: [
      'Kvælstofvådområder',
      'Minivådområder',
      'Fosforvådområder og ådale',
    ],
  },
  { label: 'Skovrejsning', color: '#166534', measures: ['Skovrejsning'] },
  {
    label: 'Lavbundsprojekter',
    color: '#b08968',
    measures: ['Lavbundsprojekter'],
  },
]
const MARS_OTHER_COLOR = '#94a3b8'
const MARS_LEGEND_ENTRIES: { label: string; color: string }[] = [
  ...MARS_LEGEND.map(({ label, color }) => ({ label, color })),
  { label: 'Andet', color: MARS_OTHER_COLOR },
]
const marsFillColor = [
  'match',
  ['get', 'virkemiddel'],
  ...MARS_LEGEND.flatMap(({ measures, color }) => [measures, color]),
  MARS_OTHER_COLOR,
] as unknown as ExpressionSpecification

type FarmFieldsMapProps = {
  farm: Farm
  fields: FieldRecord[]
  readOnly?: boolean
  isSimulationView?: boolean
  mode?: FarmInspectorMode
  lockingFieldId: string | null
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
  selectedYearIndex?: number | null
  yearValues?: FieldYearValues
  yearValuesLoading?: boolean
  selectedFieldId: string | null
  onSelectedFieldChange: (fieldId: string | null) => void
  hoveredFieldId: string | null
  onHoveredFieldChange: (fieldId: string | null) => void
  highlightedCatchmentKey?: string | null
  zoomRequest?: { fieldId: string; nonce: number }
  onAddModeChange?: (active: boolean) => void
  detachFields: (fieldIds: string[]) => Promise<string[]>
  onError: (message: string | null) => void
  search?: ReactNode
}

const defaultColorByForMode = (mode: FarmInspectorMode): ColorAttribute =>
  mode === 'rules' ? 'fieldLocked' : 'none'

type ColorBySelection = {
  forMode: FarmInspectorMode
  value: ColorAttribute
}

type HoveredMars = {
  longitude: number
  latitude: number
  title: string | null
  measure: string | null
  status: string | null
  subsidyScheme: string | null
  areaHa: number | null
}

const MAP_CONTROLS_INSET = 44
const RULE_CARD_MARGIN = 12

const isFromMapOverlay = (event: MapLayerMouseEvent) =>
  event.originalEvent.target instanceof Element &&
  event.originalEvent.target.closest('[data-map-overlay]') !== null

const withTopInset = (padding: number) => ({
  top: padding + MAP_CONTROLS_INSET,
  right: padding,
  bottom: padding,
  left: padding,
})

type FieldChangeListProps = {
  title: string
  changes: FieldRow[]
}

const FieldChangeList = ({ title, changes }: FieldChangeListProps) =>
  changes.length === 0 ? null : (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">
        {title} ({changes.length})
      </p>
      <FieldRowList rows={changes} className="max-h-32 bg-background" />
    </div>
  )

export const FarmFieldsMap = ({
  farm,
  fields,
  readOnly = false,
  isSimulationView = false,
  mode = 'values',
  lockingFieldId,
  onToggleLock,
  onBindRotation,
  selectedYearIndex = null,
  yearValues,
  yearValuesLoading = false,
  selectedFieldId,
  onSelectedFieldChange,
  hoveredFieldId,
  onHoveredFieldChange,
  highlightedCatchmentKey = null,
  zoomRequest,
  onAddModeChange,
  detachFields,
  onError,
  search,
}: FarmFieldsMapProps) => {
  const mapRef = useRef<MapRef>(null)
  const initialViewState =
    savedMapViewStates.get(farm.id) ?? defaultMapViewState
  const hasFitBounds = useRef(savedMapViewStates.has(farm.id))
  const hoverFrame = useRef<number | null>(null)
  const pendingHoveredFieldId = useRef<string | null>(null)
  const reportedHoveredFieldId = useRef<string | null>(null)
  const pannedFieldId = useRef<string | null>(null)
  const fittedCatchmentKey = useRef<string | null>(highlightedCatchmentKey)
  const appliedZoomNonce = useRef<number | null>(zoomRequest?.nonce ?? null)
  const legendStripRef = useRef<HTMLDivElement>(null)
  const [addMode, setAddMode] = useState(false)
  const [selectedRegistryFields, setSelectedRegistryFields] = useState<
    SelectedRegistryField[]
  >([])
  const [detachFieldIds, setDetachFieldIds] = useState<string[]>([])
  const [fieldActionPopup, setFieldActionPopup] = useState<{
    fieldId: string
    longitude: number
    latitude: number
  } | null>(null)
  const [cvrInput, setCvrInput] = useState(farm.cvr ?? '')
  const [highlightedCvr, setHighlightedCvr] = useState<string | null>(null)
  const [highlightedCvrFields, setHighlightedCvrFields] = useState<
    RegistryFieldSummary[]
  >([])
  const [isCvrOpen, setIsCvrOpen] = useState(false)
  const [isSavingFieldChanges, setIsSavingFieldChanges] = useState(false)

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
  const [ruleRotationOpen, setRuleRotationOpen] = useState(true)
  const ruleCardRef = useRef<HTMLDivElement>(null)
  const [overflowingLegend, setOverflowingLegend] = useState<string | null>(
    null,
  )

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
  const catchmentLabel = useCatchmentLabel(farm.id, fields)
  const hoveredRecord = hoveredField?.fieldId
    ? (fields.find((field) => field.id === hoveredField.fieldId) ?? null)
    : null
  const hoveredRotationName = hoveredRecord?.rotationId
    ? (farm.rotationLibrary.find(
        (rotation) => rotation.id === hoveredRecord.rotationId,
      )?.name ?? null)
    : null

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
  const yearStatusText =
    selectedCalendarYear === null
      ? null
      : yearValuesLoading
        ? 'Henter årstal for markerne...'
        : yearValuesFieldCount < rotationFieldCount
          ? `${yearValuesFieldCount} af ${rotationFieldCount} marker har årstal for ${selectedCalendarYear}`
          : null
  const editLegendEntries = addMode
    ? [
        ...(activeColorSpec === null ? EDIT_BASE_LEGEND : []),
        ...EDIT_CHANGE_LEGEND,
        ...(highlightedCvr ? [CVR_LEGEND_ENTRY] : []),
      ]
    : []
  const legendStripVisible =
    activeColorSpec !== null ||
    yearStatusText !== null ||
    editLegendEntries.length > 0
  const legendBins =
    activeColorSpec === null ? [] : legendEntries(activeColorSpec)
  const legendSignature = `${activeColorSpec?.label ?? ''}|${legendBins.length}|${yearStatusText ?? ''}|${editLegendEntries.map((entry) => entry.label).join(',')}`
  const legendOverflows = overflowingLegend === legendSignature
  const hasFieldGeometry = fields.some((field) => field.geometry !== null)

  const farmFieldsGeoJson = useMemo(
    () =>
      fieldsToFeatureCollection(
        fields,
        isSimulationView,
        changedFields,
        yearProperties,
      ),
    [fields, isSimulationView, changedFields, yearProperties],
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
          name: shortCropName(year.cropName),
          fullName: year.cropName,
          color: cropGroupColor(year.cropCode, year.cropName),
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
  const activeRuleField = mode === 'rules' ? selectedFarmField : undefined
  const activeRulePoint = activeRuleField
    ? fieldLabelPoint(activeRuleField)
    : null
  const activeRuleFieldId = activeRuleField?.id
  const hoveringActiveRuleField =
    activeRuleField !== undefined && hoveredFieldId === activeRuleField.id
  const attachedImkIds = useMemo(
    () =>
      fields
        .map((field) => field.imkId)
        .filter((imkId): imkId is number => imkId !== null),
    [fields],
  )
  const pendingRegistryFields = useMemo(
    () =>
      selectedRegistryFields.filter(
        (field) => !attachedImkIds.includes(field.imkId),
      ),
    [selectedRegistryFields, attachedImkIds],
  )
  const selectedImkIds = useMemo(
    () => pendingRegistryFields.map((field) => field.imkId),
    [pendingRegistryFields],
  )
  const fieldsMarkedForDetach = useMemo(
    () => fields.filter((field) => detachFieldIds.includes(field.id)),
    [fields, detachFieldIds],
  )
  const detachFieldsGeoJson = useMemo(
    () => fieldsToFeatureCollection(fieldsMarkedForDetach, isSimulationView),
    [fieldsMarkedForDetach, isSimulationView],
  )
  const fieldChangeCount =
    pendingRegistryFields.length + fieldsMarkedForDetach.length
  const detachChanges: FieldRow[] = fieldsMarkedForDetach.map((field) => ({
    key: field.id,
    label: fieldTitle(field),
    areaHa: field.areaHa,
    onUndo: () =>
      setDetachFieldIds((current) =>
        current.filter((fieldId) => fieldId !== field.id),
      ),
  }))
  const addChanges: FieldRow[] = pendingRegistryFields.map((field) => ({
    key: String(field.imkId),
    label: field.label,
    areaHa: field.areaHa,
    onUndo: () =>
      setSelectedRegistryFields((current) =>
        current.filter((selected) => selected.imkId !== field.imkId),
      ),
  }))
  const areaChangeHa =
    pendingRegistryFields.reduce((sum, field) => sum + (field.areaHa ?? 0), 0) -
    fieldsMarkedForDetach.reduce((sum, field) => sum + field.areaHa, 0)
  const actionPopupField =
    addMode && fieldActionPopup
      ? (fields.find((field) => field.id === fieldActionPopup.fieldId) ?? null)
      : null
  const actionPopupMarked =
    actionPopupField !== null && detachFieldIds.includes(actionPopupField.id)

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

  useEffect(() => {
    const map = mapRef.current
    const card = ruleCardRef.current
    if (!map || !card || activeRuleFieldId === undefined) return
    const cardRect = card.getBoundingClientRect()
    const mapRect = map.getContainer().getBoundingClientRect()
    const top = cardRect.top - (mapRect.top + MAP_CONTROLS_INSET)
    const bottom = cardRect.bottom - (mapRect.bottom - RULE_CARD_MARGIN)
    const left = cardRect.left - (mapRect.left + RULE_CARD_MARGIN)
    const right = cardRect.right - (mapRect.right - RULE_CARD_MARGIN)
    const dx = left < 0 ? left : Math.max(right, 0)
    const dy = top < 0 ? top : Math.max(bottom, 0)
    if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { duration: 300 })
  }, [activeRuleFieldId, ruleRotationOpen])

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

  const fitAllFields = useCallback(() => {
    const bounds = getFieldsBounds(fields)
    if (!bounds) return false

    mapRef.current?.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: withTopInset(56), maxZoom: 14, duration: 700 },
    )
    return true
  }, [fields])

  useEffect(() => {
    if (!isMapLoaded) return
    if (hasFitBounds.current) return
    if (!fitAllFields()) return

    hasFitBounds.current = true
    pannedFieldId.current = selectedFieldId
  }, [fitAllFields, isMapLoaded, selectedFieldId])

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
      const hadSelection = pannedFieldId.current !== null
      pannedFieldId.current = null
      if (hadSelection) fitAllFields()
      return
    }

    const field = fields.find((item) => item.id === selectedFieldId)
    if (!field) return
    pannedFieldId.current = selectedFieldId

    const bounds = getFieldsBounds([field])
    if (!bounds) return

    mapRef.current?.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: withTopInset(64), maxZoom: 16, duration: 500 },
    )
  }, [fields, isMapLoaded, selectedFieldId, fitAllFields])

  useEffect(() => {
    if (!isMapLoaded) return
    if (fittedCatchmentKey.current === highlightedCatchmentKey) return
    const hadCatchment = fittedCatchmentKey.current !== null
    fittedCatchmentKey.current = highlightedCatchmentKey
    if (highlightedCatchmentKey === null) {
      if (hadCatchment) fitAllFields()
      return
    }

    const bounds = getFieldsBounds(
      fields.filter((field) => fieldInCatchment(field, highlightedCatchmentKey)),
    )
    if (!bounds) return

    mapRef.current?.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: withTopInset(56), maxZoom: 14, duration: 700 },
    )
  }, [fields, isMapLoaded, highlightedCatchmentKey, fitAllFields])

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
      { padding: withTopInset(64), maxZoom: 16, duration: 500 },
    )
  }, [fields, isMapLoaded, zoomRequest])

  useEffect(() => {
    const strip = legendStripRef.current
    if (!strip) {
      setOverflowingLegend(null)
      return
    }

    const measure = () =>
      setOverflowingLegend(
        strip.scrollWidth - strip.clientWidth > 1 ? legendSignature : null,
      )
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [legendSignature])

  useEffect(() => {
    if (!addMode) return
    onAddModeChange?.(true)
    return () => onAddModeChange?.(false)
  }, [addMode, onAddModeChange])

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
    setSelectedRegistryFields([])
    setDetachFieldIds([])
    setFieldActionPopup(null)
    setHighlightedCvr(null)
    setHighlightedCvrFields([])
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
      setHighlightedCvrFields(fieldsForCvr)

      if (fieldsForCvr.length > 0) {
        const bounds = await fetcher<RegistryBounds>(
          `/registry/fields/bounds?cvr=${encodeURIComponent(cvr)}`,
        )
        mapRef.current?.fitBounds(
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
          ],
          { padding: withTopInset(56), maxZoom: 14, duration: 700 },
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
    setSelectedRegistryFields((current) => [
      ...current,
      ...highlightedCvrFields
        .filter(
          (field) =>
            !attachedImkIds.includes(field.imkId) &&
            !current.some((selected) => selected.imkId === field.imkId),
        )
        .map((field) => ({
          imkId: field.imkId,
          label: registryFieldLabel(field.imkId, field.fieldNumber),
          areaHa: field.areaHa,
        })),
    ])
  }

  const saveFieldChanges = async () => {
    if (readOnly) return

    if (fieldChangeCount === 0) {
      toggleAddMode()
      return
    }

    setIsSavingFieldChanges(true)
    try {
      if (selectedImkIds.length > 0) {
        await importRegistryFields(farm.id, selectedImkIds)
        setSelectedRegistryFields([])
      }
      if (fieldsMarkedForDetach.length === 0) {
        await refreshFarmFields(farm.id)
        onError(null)
        setAddMode(false)
        return
      }
      const failedFieldIds = await detachFields(
        fieldsMarkedForDetach.map((field) => field.id),
      )
      setDetachFieldIds(failedFieldIds)
      if (failedFieldIds.length === 0) setAddMode(false)
    } catch {
      await refreshFarmFields(farm.id)
      onError('Kunne ikke tilføje de valgte marker til bedriften.')
    } finally {
      setIsSavingFieldChanges(false)
    }
  }

  const toggleFieldDetach = (fieldId: string) => {
    setDetachFieldIds((current) =>
      current.includes(fieldId)
        ? current.filter((currentFieldId) => currentFieldId !== fieldId)
        : [...current, fieldId],
    )
    setFieldActionPopup(null)
  }

  const showFieldDetails = (fieldId: string) => {
    setFieldActionPopup(null)
    onSelectedFieldChange(fieldId)
  }

  useEscapeKey(
    useCallback(() => {
      if (fieldActionPopup === null) return false
      setFieldActionPopup(null)
      return true
    }, [fieldActionPopup]),
  )

  const handleMapClick = (event: MapLayerMouseEvent) => {
    if (isFromMapOverlay(event)) return

    if (addMode) {
      const candidate = event.features?.find((feature) =>
        REGISTRY_CANDIDATE_LAYER_IDS.includes(feature.layer.id),
      )
      const imkId = toFiniteNumber(candidate?.properties?.imk_id)
      const ownedImkId = toFiniteNumber(
        event.features?.find(
          (feature) => feature.layer.id === 'registry-owned-fill',
        )?.properties?.imk_id,
      )
      const farmFieldId =
        event.features?.find(
          (feature) => feature.layer.id === 'farm-fields-fill',
        )?.properties?.fieldId ??
        fields.find((field) => field.imkId === ownedImkId)?.id

      if (imkId !== null) {
        const label = registryFieldLabel(imkId, candidate?.properties?.marknr)
        const areaHa = toFiniteNumber(candidate?.properties?.area_ha)
        setSelectedRegistryFields((current) =>
          current.some((field) => field.imkId === imkId)
            ? current.filter((field) => field.imkId !== imkId)
            : [...current, { imkId, label, areaHa }],
        )
        setFieldActionPopup(null)
      } else if (typeof farmFieldId === 'string') {
        setFieldActionPopup({
          fieldId: farmFieldId,
          longitude: event.lngLat.lng,
          latitude: event.lngLat.lat,
        })
      } else {
        setFieldActionPopup(null)
        return
      }

      pannedFieldId.current = null
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
    if (isFromMapOverlay(event)) {
      setHoveredField(null)
      setHoveredMars(null)
      reportHoveredField(null)
      mapRef.current?.getCanvas().style.setProperty('cursor', '')
      return
    }

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
        title: (marsFeature.properties?.titel as string | undefined) ?? null,
        measure:
          (marsFeature.properties?.virkemiddel as string | undefined) ?? null,
        status: (marsFeature.properties?.status as string | undefined) ?? null,
        subsidyScheme:
          (marsFeature.properties?.tilskudsordning as string | undefined) ?? null,
        areaHa:
          typeof marsFeature.properties?.areal_ha === 'number'
            ? marsFeature.properties.areal_ha
            : null,
      })
      return
    }

    setHoveredMars(null)

    const feature = event.features?.find((item) =>
      addMode
        ? EDIT_MODE_LAYER_IDS.includes(item.layer.id)
        : item.layer.id === 'farm-fields-fill',
    )

    if (!feature) {
      setHoveredField(null)
      reportHoveredField(null)
      mapRef.current?.getCanvas().style.setProperty('cursor', '')
      return
    }

    const isRegistry = feature.layer.id !== 'farm-fields-fill'
    const imkId = isRegistry
      ? feature.properties?.imk_id
      : feature.properties?.imkId
    const fieldNumber = isRegistry ? feature.properties?.marknr : null
    const farmName = !isRegistry ? feature.properties?.name : null
    const registryImkId = toFiniteNumber(imkId)
    const primary =
      typeof farmName === 'string' && farmName.length > 0
        ? farmName
        : registryImkId !== null
          ? registryFieldLabel(registryImkId, fieldNumber)
          : 'Manuel mark'
    const yearCropRaw = isRegistry ? null : feature.properties?.yearCropName
    const yearNLoadRaw = isRegistry ? null : feature.properties?.yearNLoadKgHa
    const yearQuotaStatusRaw = isRegistry
      ? null
      : feature.properties?.yearQuotaStatus
    const isOwnedRegistry = feature.layer.id === 'registry-owned-fill'
    const hoveredFarmFieldId = isOwnedRegistry
      ? fields.find((field) => field.imkId === registryImkId)?.id
      : isRegistry
        ? null
        : feature.properties?.fieldId
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
      fieldId: typeof hoveredFarmFieldId === 'string' ? hoveredFarmFieldId : null,
      properties: feature.properties ?? {},
      registry: isRegistry,
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
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-muted shadow-xs @container">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-2 p-2">
        {search ? <div className="pointer-events-auto">{search}</div> : null}
        <div className="pointer-events-auto flex h-7 min-w-0 items-center gap-2 rounded-md border bg-card pl-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <span className="hidden shrink-0 text-xs text-muted-foreground @md:inline">
            Farvelæg
          </span>
          <select
            aria-label="Farvelæg marker"
            title="Farvelæg marker"
            className="h-full w-full min-w-0 max-w-40 rounded-r-md bg-transparent pr-2 text-xs outline-none"
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
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              className="pointer-events-auto shrink-0 gap-1.5 bg-card shadow-sm"
              aria-label="Lag på kortet"
              title="Lag på kortet"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden @lg:inline">Lag</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {activeColorSpec !== null ? (
              <>
                <DropdownMenuLabel>
                  {activeColorSpec.label}
                  {formatLegendUnit(activeColorSpec)
                    ? ` (${formatLegendUnit(activeColorSpec)})`
                    : ''}
                </DropdownMenuLabel>
                <ul className="max-h-64 space-y-1 overflow-y-auto px-2 pb-1">
                  {legendBins.map((entry) => (
                    <li
                      key={entry.label}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className="inline-block h-3 w-4 shrink-0 rounded-sm border border-black/10"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span>{entry.label}</span>
                    </li>
                  ))}
                </ul>
                {isFarmOnlyAttribute ? (
                  <p className="px-2 pb-1 text-xs italic text-muted-foreground">
                    Vises kun for tilknyttede marker.
                  </p>
                ) : null}
                <DropdownMenuSeparator />
              </>
            ) : null}
            {hasSelectedYear ? (
              <>
                <DropdownMenuCheckboxItem
                  checked={showCropLabels}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    setShowCropLabels(Boolean(checked))
                  }
                >
                  Vis afgrødenavne for {selectedCalendarYear}
                </DropdownMenuCheckboxItem>
                {showCropLabels && mapZoom < CROP_LABEL_MIN_ZOOM ? (
                  <p className="pb-1 pl-8 pr-2 text-xs text-muted-foreground">
                    Zoom ind for at se navnene.
                  </p>
                ) : null}
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuCheckboxItem
              checked={showMars}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => setShowMars(Boolean(checked))}
            >
              Grøn Trepart - Omlægningsplan
            </DropdownMenuCheckboxItem>
            {showMars ? (
              <ul className="space-y-1 pb-1 pl-8 pr-2">
                {MARS_LEGEND_ENTRIES.map((entry) => (
                  <li
                    key={entry.label}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="inline-block h-3 w-4 shrink-0 rounded-sm border border-black/10"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span>{entry.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="xs"
          className="pointer-events-auto shrink-0 gap-1.5 bg-card shadow-sm"
          aria-label="Vis alle marker"
          title={
            hasFieldGeometry ? 'Vis alle marker' : 'Ingen marker at vise endnu'
          }
          disabled={!hasFieldGeometry}
          onClick={() => {
            fitAllFields()
          }}
        >
          <Maximize className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden @lg:inline">Vis alle</span>
        </Button>

        {readOnly ? (
          <span className="ml-auto hidden min-w-0 truncate rounded-md bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm @2xl:block">
            {mode === 'rules'
              ? 'Klik på en mark for at gå til dens række i listen.'
              : 'Klik på en simuleringsmark for at gennemgå den.'}
          </span>
        ) : null}

        {!readOnly ? (
          <Button
            className={cn(
              'pointer-events-auto ml-auto shrink-0 shadow-sm',
              !addMode &&
                'bg-card font-semibold text-primary hover:text-primary',
            )}
            onClick={() => void (addMode ? saveFieldChanges() : toggleAddMode())}
            size="xs"
            variant={addMode ? 'default' : 'outline'}
            loading={isSavingFieldChanges}
          >
            {!addMode
              ? 'Rediger marker'
              : isSavingFieldChanges
                ? 'Gemmer...'
                : fieldChangeCount > 0
                  ? `Gem ${fieldChangeCount} ${fieldChangeCount === 1 ? 'ændring' : 'ændringer'}`
                  : 'Færdig'}
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          'map-controls-inset relative min-h-0 flex-1',
          legendStripVisible && 'map-legend-inset',
        )}
      >
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
            ...(addMode ? EDIT_MODE_LAYER_IDS : ['farm-fields-fill']),
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
          <NavigationControl
            position="top-right"
            showCompass={false}
            showZoom={true}
          />

          <Source id="farm-fields" type="geojson" data={farmFieldsGeoJson}>
            <Layer
              id="farm-fields-fill"
              type="fill"
              paint={{
                'fill-color': farmThemedColor ?? '#16a34a',
                'fill-opacity': buildCatchmentFillOpacity(
                  addMode ? 0.28 : farmThemedColor ? 0.7 : 0.5,
                  highlightedCatchmentKey,
                  catchmentKey(null),
                ),
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

          {addMode ? (
            <Source
              id="detach-farm-fields"
              type="geojson"
              data={detachFieldsGeoJson}
            >
              <Layer
                id="detach-farm-fields-fill"
                type="fill"
                paint={{ 'fill-color': '#dc2626', 'fill-opacity': 0.5 }}
              />
              <Layer
                id="detach-farm-fields-outline"
                type="line"
                paint={{
                  'line-color': '#b91c1c',
                  'line-width': 2.5,
                  'line-opacity': 0.95,
                }}
              />
            </Source>
          ) : null}

          {showMars ? (
            <Source
              key={marsTileUrl}
              id="mars-projects"
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
            ? lockedFieldMarkers
                .filter(({ field }) => field.id !== activeRuleField?.id)
                .map(({ field, point }) => (
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
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-locked/50 bg-white/95 shadow-md"
                    >
                      <Lock
                        className="h-4 w-4 text-locked"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    </span>
                  </Marker>
                ))
            : null}
          {activeRuleField && activeRulePoint ? (
            <Marker
              longitude={activeRulePoint[0]}
              latitude={activeRulePoint[1]}
              anchor="bottom"
              offset={[0, -6]}
              style={{ zIndex: 1 }}
            >
              <div ref={ruleCardRef}>
                <MapRuleCard
                  field={activeRuleField}
                  locking={lockingFieldId === activeRuleField.id}
                  onToggleLock={onToggleLock}
                  onBindRotation={onBindRotation}
                  rotationOpen={ruleRotationOpen}
                  onRotationOpenChange={setRuleRotationOpen}
                  onClose={() => onSelectedFieldChange(null)}
                />
              </div>
            </Marker>
          ) : null}
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
                        ? {
                            backgroundColor: marker.color,
                            color: marker.textColor ?? undefined,
                          }
                        : undefined
                    }
                  >
                    {marker.label}
                  </span>
                </Marker>
              ))
            : null}

          {hoveredField && !hoveringActiveRuleField && !actionPopupField ? (
            <Popup
              longitude={hoveredField.longitude}
              latitude={hoveredField.latitude}
              closeButton={false}
              closeOnClick={false}
              anchor="top"
              offset={8}
              maxWidth="none"
              className="field-tooltip"
            >
              <FieldTooltip
                hovered={hoveredField}
                field={hoveredRecord}
                rotationName={hoveredRotationName}
                catchmentLabel={catchmentLabel}
                colorBy={colorBy}
                isSimulationView={isSimulationView}
                selectedCalendarYear={selectedCalendarYear}
                yearValuesLoading={yearValuesLoading}
              />
            </Popup>
          ) : null}

          {actionPopupField && fieldActionPopup ? (
            <Popup
              longitude={fieldActionPopup.longitude}
              latitude={fieldActionPopup.latitude}
              closeButton={false}
              closeOnClick={false}
              anchor="top"
              offset={8}
              maxWidth="none"
              className="field-tooltip"
            >
              <div
                role="dialog"
                aria-label={fieldTitle(actionPopupField)}
                className="w-60 text-xs"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.stopPropagation()
                  setFieldActionPopup(null)
                }}
              >
                <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {fieldTitle(actionPopupField)}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatNumber(actionPopupField.areaHa)} ha
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="size-7 shrink-0 p-0 text-muted-foreground"
                    aria-label="Luk"
                    title="Luk"
                    onClick={() => setFieldActionPopup(null)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                {actionPopupMarked ? (
                  <p className="px-3 pb-2 text-muted-foreground">
                    Fjernes, når du gemmer.
                  </p>
                ) : null}
                <div className="grid gap-1.5 border-t p-2">
                  <Button
                    size="sm"
                    variant="outline"
                    autoFocus
                    className={cn(
                      !actionPopupMarked &&
                        'text-destructive hover:text-destructive',
                    )}
                    onClick={() => toggleFieldDetach(actionPopupField.id)}
                  >
                    {actionPopupMarked
                      ? 'Fortryd fjernelse'
                      : 'Fjern fra bedriften'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => showFieldDetails(actionPopupField.id)}
                  >
                    Se detaljer
                  </Button>
                </div>
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
                  {hoveredMars.title ?? 'MARS-projekt'}
                </span>
                {hoveredMars.measure ? (
                  <span>{hoveredMars.measure}</span>
                ) : null}
                {hoveredMars.subsidyScheme ? (
                  <span className="text-muted-foreground">
                    {hoveredMars.subsidyScheme}
                  </span>
                ) : null}
                <span className="text-muted-foreground">
                  {hoveredMars.status ?? 'Status ukendt'}
                  {hoveredMars.areaHa !== null
                    ? ` · ${formatNumber(hoveredMars.areaHa)} ha`
                    : ''}
                </span>
              </div>
            </Popup>
          ) : null}
        </Map>

        {legendStripVisible ? (
          <div
            ref={legendStripRef}
            role="group"
            aria-label="Legende"
            tabIndex={legendOverflows ? 0 : undefined}
            className={cn(
              'map-legend-strip absolute inset-x-0 bottom-0 z-10 flex h-6 items-center gap-3 overflow-x-auto border-t bg-background/85 px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              legendOverflows && 'map-legend-strip-fade',
            )}
          >
            {activeColorSpec !== null ? (
              <span className="shrink-0 font-medium text-muted-foreground">
                {activeColorSpec.label}
                {formatLegendUnit(activeColorSpec)
                  ? ` (${formatLegendUnit(activeColorSpec)})`
                  : ''}
              </span>
            ) : null}
            {[...legendBins, ...editLegendEntries].map((entry) => (
              <span
                key={entry.label}
                className="flex shrink-0 items-center gap-1"
              >
                <span
                  className="inline-block h-3 w-4 rounded-sm border border-black/10"
                  style={{ backgroundColor: entry.color }}
                />
                <span>{entry.label}</span>
              </span>
            ))}
            {yearStatusText !== null ? (
              <span
                role="status"
                title={yearStatusText}
                className="min-w-24 truncate text-muted-foreground"
              >
                {yearStatusText}
              </span>
            ) : null}
          </div>
        ) : null}

        {addMode ? (
          <Card className="absolute left-4 top-4 z-10 max-h-[calc(100%-2rem)] w-[min(18rem,calc(100%-2rem))] overflow-y-auto bg-background/95 shadow-lg">
            <CardHeader className="p-4 pb-2">
              <CardTitle>Rediger marker</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 text-sm">
              {fieldChangeCount > 0 ? (
                <>
                  <FieldChangeList title="Fjernes" changes={detachChanges} />
                  <FieldChangeList title="Tilføjes" changes={addChanges} />
                  <p className="text-xs text-muted-foreground">
                    {describeFarmAfterChanges(
                      fields.length,
                      fields.length +
                        pendingRegistryFields.length -
                        fieldsMarkedForDetach.length,
                      areaChangeHa,
                    )}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Klik på en registermark for at tilføje den, eller på en af
                  bedriftens marker for at fjerne den eller se detaljer.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => void saveFieldChanges()}
                  disabled={fieldChangeCount === 0}
                  loading={isSavingFieldChanges}
                >
                  {isSavingFieldChanges ? 'Gemmer...' : 'Gem ændringer'}
                </Button>
                <Button
                  variant="outline"
                  onClick={toggleAddMode}
                  disabled={isSavingFieldChanges}
                >
                  Annuller
                </Button>
              </div>
              <div className="rounded-md border bg-background/80">
                <DisclosureButton
                  open={isCvrOpen}
                  onToggle={() => setIsCvrOpen((current) => !current)}
                  label="CVR-fremhævelse"
                  aria-controls="add-mode-cvr"
                  hint={highlightedCvr ? `CVR ${highlightedCvr}` : undefined}
                  className="w-full px-3 py-2"
                />
                {isCvrOpen ? (
                  <div id="add-mode-cvr" className="space-y-2 border-t p-3">
                    <Input
                      value={cvrInput}
                      inputMode="numeric"
                      placeholder="12345678"
                      onChange={(event) => setCvrInput(event.target.value)}
                    />
                    <div className="grid gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void highlightFieldsForCvr()}
                        loading={isLoadingCvrFields}
                      >
                        {isLoadingCvrFields ? 'Indlæser...' : 'Fremhæv marker'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={selectHighlightedCvrFields}
                        disabled={
                          !highlightedCvr || highlightedCvrFields.length === 0
                        }
                      >
                        Tilføj marker for CVR
                      </Button>
                    </div>
                    {highlightedCvr ? (
                      <p className="text-xs text-muted-foreground">
                        Fremhæver{' '}
                        {formatFieldCount(highlightedCvrFields.length)} for CVR{' '}
                        {highlightedCvr}.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
