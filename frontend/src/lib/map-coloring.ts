import type { ExpressionSpecification } from 'maplibre-gl'

export type ColorAttribute =
  | 'none'
  | 'retention'
  | 'jbnr'
  | 'leaching'
  | 'nLoad'
  | 'nQuotaKgN'
  | 'db2'
  | 'vandopland'
  | 'rotationChanged'
  | 'inTakeoutPlan'

export type ColorSource = 'both' | 'farm'

type NumericBin = {
  max: number
  color: string
  label: string
}

type CategoryBin = {
  value: number
  color: string
  label: string
}

type NumericSpec = {
  kind: 'numeric'
  label: string
  unit: string
  source: ColorSource
  property: string
  bins: NumericBin[]
  aboveColor: string
  aboveLabel: string
  fallbackColor: string
}

type CategorySpec = {
  kind: 'category'
  label: string
  unit: string
  source: ColorSource
  property: string
  bins: CategoryBin[]
  fallbackColor: string
}

type HashedSpec = {
  kind: 'hashed'
  label: string
  unit: string
  source: ColorSource
  property: string
  fallbackColor: string
}

export type ColorSpec = NumericSpec | CategorySpec | HashedSpec

const formatNumber = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 })

const numericLegend = (bins: NumericBin[], aboveLabel: string, aboveColor: string) => {
  const entries = [
    ...bins.map((bin) => ({ color: bin.color, label: bin.label })),
    { color: aboveColor, label: aboveLabel },
  ]
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.color}:${entry.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const NEUTRAL_FALLBACK = '#cbd5e1'

const RETENTION: NumericSpec = {
  kind: 'numeric',
  label: 'Retention',
  unit: '%',
  source: 'both',
  property: 'retention',
  bins: [
    { max: 20, color: '#1b36e6', label: '< 20 %' },
    { max: 40, color: '#468fef', label: '20–40 %' },
    { max: 60, color: '#1af3f3', label: '40–60 %' },
    { max: 80, color: '#45e18e', label: '60–80 %' },
    { max: Number.POSITIVE_INFINITY, color: '#36d127', label: '> 80 %' },
  ],
  aboveColor: '#36d127',
  aboveLabel: '> 80 %',
  fallbackColor: NEUTRAL_FALLBACK,
}

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (channel: number) =>
    Math.round(channel).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Light yellow (JB 1) → dark brown (JB 12), linearly interpolated per JB nr.
const JB_GRADIENT_START: [number, number, number] = [254, 243, 199] // #fef3c7
const JB_GRADIENT_END: [number, number, number] = [69, 26, 3] // #451a03

const jbGradientColor = (jbnr: number): string => {
  const t = (Math.min(Math.max(jbnr, 1), 12) - 1) / 11
  const [r0, g0, b0] = JB_GRADIENT_START
  const [r1, g1, b1] = JB_GRADIENT_END
  return rgbToHex(r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t)
}

const JB_NR: CategorySpec = {
  kind: 'category',
  label: 'JB nr.',
  unit: '',
  source: 'both',
  property: 'jbnr',
  bins: Array.from({ length: 12 }, (_, i) => {
    const jbnr = i + 1
    return { value: jbnr, color: jbGradientColor(jbnr), label: `JB ${jbnr}` }
  }),
  fallbackColor: NEUTRAL_FALLBACK,
}

const N_QUOTA: NumericSpec = {
  kind: 'numeric',
  label: 'Kvælstofkvote',
  unit: 'kg N/ha',
  source: 'both',
  property: 'nQuotaKgN',
  bins: [
    { max: 100, color: '#dbeafe', label: '< 100' },
    { max: 150, color: '#93c5fd', label: '100–150' },
    { max: 200, color: '#3b82f6', label: '150–200' },
    { max: Number.POSITIVE_INFINITY, color: '#1d4ed8', label: '≥ 200' },
  ],
  aboveColor: '#1d4ed8',
  aboveLabel: '≥ 200',
  fallbackColor: NEUTRAL_FALLBACK,
}

const LEACHING: NumericSpec = {
  kind: 'numeric',
  label: 'Udvaskning',
  unit: 'kg N/ha',
  source: 'farm',
  property: 'leaching',
  bins: [
    { max: 20, color: '#fee2e2', label: '< 20' },
    { max: 40, color: '#fca5a5', label: '20–40' },
    { max: 60, color: '#f87171', label: '40–60' },
    { max: 80, color: '#dc2626', label: '60–80' },
    { max: Number.POSITIVE_INFINITY, color: '#7f1d1d', label: '≥ 80' },
  ],
  aboveColor: '#7f1d1d',
  aboveLabel: '≥ 80',
  fallbackColor: NEUTRAL_FALLBACK,
}

const N_LOAD: NumericSpec = {
  kind: 'numeric',
  label: 'Udledning',
  unit: 'kg N/ha',
  source: 'farm',
  property: 'nLoad',
  bins: [
    { max: 20, color: '#ffedd5', label: '< 20' },
    { max: 40, color: '#fdba74', label: '20–40' },
    { max: 60, color: '#fb923c', label: '40–60' },
    { max: 80, color: '#ea580c', label: '60–80' },
    { max: Number.POSITIVE_INFINITY, color: '#9a3412', label: '≥ 80' },
  ],
  aboveColor: '#9a3412',
  aboveLabel: '≥ 80',
  fallbackColor: NEUTRAL_FALLBACK,
}

// DB2 in practice is non-negative; gradient red(low) → green(high).
const DB2: NumericSpec = {
  kind: 'numeric',
  label: 'DB2',
  unit: 'kr./ha',
  source: 'farm',
  property: 'db2',
  bins: [
    { max: 2000, color: '#dc2626', label: '< 2.000' },
    { max: 5000, color: '#f97316', label: '2.000–5.000' },
    { max: 8000, color: '#facc15', label: '5.000–8.000' },
    { max: 12000, color: '#84cc16', label: '8.000–12.000' },
    { max: Number.POSITIVE_INFINITY, color: '#15803d', label: '≥ 12.000' },
  ],
  aboveColor: '#15803d',
  aboveLabel: '≥ 12.000',
  fallbackColor: NEUTRAL_FALLBACK,
}

// Vandopland is a categorical id with ~107 unique values; we hash the id to
// HSL with a tertiary lightness bucket so neighbouring catchments are easier
// to distinguish even though the 4-colour problem is unsolved.
const VANDOPLAND: HashedSpec = {
  kind: 'hashed',
  label: 'Vandopland',
  unit: '',
  source: 'both',
  property: 'kystvandId',
  fallbackColor: NEUTRAL_FALLBACK,
}

// Highlights fields whose simulation rotation differs from the live ("Aktuel")
// rotation. Farm-only: registry tiles carry no simulation context. Unchanged
// fields keep the default farm green so the Aktuel view looks normal; only
// changed fields light up blue.
const ROTATION_CHANGED: CategorySpec = {
  kind: 'category',
  label: 'Ændret sædskifte',
  unit: '',
  source: 'farm',
  property: 'rotationChanged',
  bins: [
    { value: 1, color: '#2563eb', label: 'Ændret' },
    { value: 0, color: '#16a34a', label: 'Uændret' },
  ],
  fallbackColor: '#16a34a',
}

// Whether a field is part of the takeout/conversion plan ("i omlægning"). Works
// on both layers: the farm GeoJSON emits inTakeoutPlan as 1/0, and the registry
// MVT exposes in_takeout_plan::int (mapped via REGISTRY_PROPERTY_NAMES).
const TAKEOUT: CategorySpec = {
  kind: 'category',
  label: 'Omlægning',
  unit: '',
  source: 'both',
  property: 'inTakeoutPlan',
  bins: [
    { value: 1, color: '#9333ea', label: 'I omlægning' },
    { value: 0, color: NEUTRAL_FALLBACK, label: 'Ikke i omlægning' },
  ],
  fallbackColor: NEUTRAL_FALLBACK,
}

export const COLOR_SPECS: Record<Exclude<ColorAttribute, 'none'>, ColorSpec> = {
  retention: RETENTION,
  jbnr: JB_NR,
  nQuotaKgN: N_QUOTA,
  leaching: LEACHING,
  nLoad: N_LOAD,
  db2: DB2,
  vandopland: VANDOPLAND,
  rotationChanged: ROTATION_CHANGED,
  inTakeoutPlan: TAKEOUT,
}

export const ATTRIBUTE_OPTIONS: { value: ColorAttribute; label: string }[] = [
  { value: 'none', label: 'Ingen' },
  { value: 'retention', label: 'Retention' },
  { value: 'jbnr', label: 'JB nr.' },
  { value: 'nQuotaKgN', label: 'Kvælstofkvote' },
  { value: 'leaching', label: 'Udvaskning' },
  { value: 'nLoad', label: 'Udledning' },
  { value: 'db2', label: 'DB2' },
  { value: 'vandopland', label: 'Vandopland' },
  { value: 'rotationChanged', label: 'Ændret sædskifte' },
  { value: 'inTakeoutPlan', label: 'Omlægning' },
]

// Farm GeoJSON properties use camelCase (matching FieldRecord).
// Registry MVT properties use snake_case (matching SQL column names).
const REGISTRY_PROPERTY_NAMES: Record<string, string> = {
  retention: 'retention',
  jbnr: 'jbnr',
  nQuotaKgN: 'n_quota_kg_n',
  kystvandId: 'kystvand_id',
  inTakeoutPlan: 'in_takeout_plan',
}

export const registryPropertyFor = (spec: ColorSpec): string | null => {
  const mapped = REGISTRY_PROPERTY_NAMES[spec.property]
  return mapped ?? null
}

// Known kystvand ids in the registry (107 unique values, dumped from the GPKG
// source). If the upstream dataset ever introduces a new id, polygons with
// that id will render in the neutral fallback colour until this list is
// updated.
const KYSTVAND_IDS: readonly number[] = [
  1, 2, 6, 16, 17, 18, 24, 25, 28, 29, 34, 35, 36, 37, 38, 44, 45, 46, 47, 48,
  49, 56, 59, 62, 68, 72, 74, 80, 82, 83, 84, 85, 86, 87, 89, 90, 92, 93, 95,
  96, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 113, 114, 119,
  120, 121, 122, 123, 124, 125, 127, 128, 129, 130, 131, 132, 133, 136, 137,
  138, 139, 140, 141, 142, 144, 145, 146, 147, 154, 157, 158, 159, 160, 165,
  200, 201, 204, 206, 207, 208, 209, 212, 214, 216, 217, 219, 221, 222, 224,
  225, 231, 232, 233, 234, 235, 236, 238,
]

const hslToHex = (h: number, s: number, l: number): string => {
  const sN = s / 100
  const lN = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sN * Math.min(lN, 1 - lN)
  const f = (n: number) =>
    lN - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  const toHex = (x: number) =>
    Math.round(255 * x).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

// Deterministic per-id colour built once at module load. Golden-ratio hue
// rotation distributes hues evenly; lightness varies by (id mod 3) so
// neighbouring ids that happen to collide on hue still differ in luminance.
const buildKystvandColors = (): Map<number, string> => {
  const colors = new Map<number, string>()
  const lightnessByMod3 = [45, 60, 75]
  for (const id of KYSTVAND_IDS) {
    const hue = (id * 137.508) % 360
    const lightness = lightnessByMod3[id % 3]
    colors.set(id, hslToHex(hue, 65, lightness))
  }
  return colors
}

const HASHED_COLORS_BY_PROPERTY: Record<string, Map<number, string> | undefined> = {
  kystvandId: buildKystvandColors(),
  kystvand_id: buildKystvandColors(),
}

export const buildFillColor = (
  spec: ColorSpec,
  propertyOverride?: string,
): ExpressionSpecification => {
  const property = propertyOverride ?? spec.property
  if (spec.kind === 'category') {
    const matchExpr: unknown[] = ['match', ['get', property]]
    spec.bins.forEach((bin) => {
      matchExpr.push(bin.value, bin.color)
    })
    matchExpr.push(spec.fallbackColor)
    return matchExpr as ExpressionSpecification
  }

  if (spec.kind === 'hashed') {
    // Precomputed per-id colour lookup. Maplibre expressions cannot construct
    // HSL at runtime (no 'hsl' operator), so we bake a `match` expression from
    // the known id set. Unknown ids fall through to the neutral fallback.
    const matchExpr: unknown[] = ['match', ['to-number', ['get', property]]]
    HASHED_COLORS_BY_PROPERTY[property]?.forEach((color, id) => {
      matchExpr.push(id, color)
    })
    matchExpr.push(spec.fallbackColor)
    return matchExpr as ExpressionSpecification
  }

  // Numeric "step" expression. Maplibre's step requires strictly increasing stops.
  const sortedBins = [...spec.bins].sort((a, b) => a.max - b.max)
  const stepExpr: unknown[] = [
    'step',
    ['coalesce', ['to-number', ['get', property], -1], -1],
    spec.fallbackColor,
    0,
    sortedBins[0].color,
  ]

  for (let i = 1; i < sortedBins.length; i += 1) {
    stepExpr.push(sortedBins[i - 1].max, sortedBins[i].color)
  }

  return stepExpr as ExpressionSpecification
}

export const legendEntries = (
  spec: ColorSpec,
): { color: string; label: string }[] => {
  if (spec.kind === 'category') {
    const seen = new Set<string>()
    return spec.bins.filter((bin) => {
      if (seen.has(bin.label)) return false
      seen.add(bin.label)
      return true
    })
  }
  if (spec.kind === 'hashed') {
    return [{ color: NEUTRAL_FALLBACK, label: 'Kategorisk farvet på id' }]
  }
  return numericLegend(spec.bins, spec.aboveLabel, spec.aboveColor)
}

export const formatLegendUnit = (spec: ColorSpec) => spec.unit

export { formatNumber as formatLegendNumber }
