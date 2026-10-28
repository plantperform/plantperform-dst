import type { VisibilityState } from '@tanstack/react-table'

export type FieldsSortKey =
  | 'name'
  | 'areaHa'
  | 'cropCode'
  | 'cropYear'
  | 'catchment'
  | 'nNormPct'
  | 'db2'
  | 'nLoad'
  | 'leaching'
  | 'feedUnits'
  | 'nLoadQuotaKgN'
  | 'inTakeoutPlan'
  | 'retention'
  | 'soilTypeNumber'

export type FieldsSortDirection = 'asc' | 'desc'

export type FieldsSortState = {
  key: FieldsSortKey
  direction: FieldsSortDirection
}

export const DEFAULT_FIELDS_SORT: FieldsSortState = {
  key: 'name',
  direction: 'asc',
}

const MANURE_COLUMN_IDS = ['manureUtilised', 'manureTons']

// The Gødning group's columns, shown and hidden together.
export const FERTILISER_COLUMN_IDS = [
  'cropNorm',
  'precedingCropValue',
  'mineralFertiliser',
  'availableN',
  ...MANURE_COLUMN_IDS,
]

export const OPTIONAL_COLUMN_IDS = [
  'cropRotation',
  'nNormPct',
  'db2',
  'quotaStatus',
  ...FERTILISER_COLUMN_IDS,
  'catchment',
  'nLoad',
  'leaching',
  'feedUnits',
  'nLoadQuotaKgN',
  'soilSummary',
  'inTakeoutPlan',
  'retention',
  'soilTypeNumber',
]

const SIMULATION_ONLY_COLUMN_IDS = ['nNormPct', 'db2', ...FERTILISER_COLUMN_IDS]

const SIMULATION_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'nNormPct',
  'db2',
  'quotaStatus',
])
const CURRENT_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'quotaStatus',
  'nLoadQuotaKgN',
  'soilSummary',
])

const columnsStorageKey = (isSimulationView: boolean) =>
  isSimulationView
    ? 'plantperform.farmColumns.simulation'
    : 'plantperform.farmColumns.current'

export const buildDefaultColumnVisibility = (
  isSimulationView: boolean,
): VisibilityState => {
  const visible = isSimulationView
    ? SIMULATION_DEFAULT_VISIBLE_COLUMNS
    : CURRENT_DEFAULT_VISIBLE_COLUMNS
  return Object.fromEntries(
    OPTIONAL_COLUMN_IDS.map((id) => [id, visible.has(id)]),
  )
}

export const readStoredColumnVisibility = (
  isSimulationView: boolean,
): VisibilityState => {
  const defaults = buildDefaultColumnVisibility(isSimulationView)
  try {
    const stored = window.localStorage.getItem(
      columnsStorageKey(isSimulationView),
    )
    if (!stored) return defaults
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null) return defaults
    const entries = parsed as Record<string, unknown>
    return Object.fromEntries(
      OPTIONAL_COLUMN_IDS.map((id) => {
        const value = entries[id]
        return [
          id,
          typeof value === 'boolean' &&
          (isSimulationView || !SIMULATION_ONLY_COLUMN_IDS.includes(id))
            ? value
            : defaults[id],
        ]
      }),
    )
  } catch {
    return defaults
  }
}

export const withoutManureColumns = (
  visibility: VisibilityState,
): VisibilityState => ({
  ...visibility,
  ...Object.fromEntries(MANURE_COLUMN_IDS.map((id) => [id, false])),
})

export const storeColumnVisibility = (
  isSimulationView: boolean,
  visibility: VisibilityState,
) => {
  try {
    window.localStorage.setItem(
      columnsStorageKey(isSimulationView),
      JSON.stringify(visibility),
    )
  } catch {
    return
  }
}
