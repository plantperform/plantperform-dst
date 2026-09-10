import type { VisibilityState } from '@tanstack/react-table'

export type FieldsSortKey =
  | 'name'
  | 'areaHa'
  | 'kystvandopland'
  | 'db2'
  | 'nLoad'
  | 'leaching'
  | 'fen'
  | 'udledningskvoteMarkKgn'
  | 'inTakeoutPlan'
  | 'retention'
  | 'jbnr'

export type FieldsSortDirection = 'asc' | 'desc'

export type FieldsSortState = {
  key: FieldsSortKey
  direction: FieldsSortDirection
}

export const DEFAULT_FIELDS_SORT: FieldsSortState = {
  key: 'name',
  direction: 'asc',
}

const RULES_SORT_KEYS: FieldsSortKey[] = ['name', 'areaHa']

export const resolveEffectiveFieldsSort = (
  sort: FieldsSortState,
  isRules: boolean,
): FieldsSortState =>
  isRules && !RULES_SORT_KEYS.includes(sort.key) ? DEFAULT_FIELDS_SORT : sort

export const OPTIONAL_COLUMN_IDS = [
  'cropRotation',
  'db2',
  'quotaStatus',
  'kystvandopland',
  'nLoad',
  'leaching',
  'fen',
  'udledningskvoteMarkKgn',
  'soilSummary',
  'inTakeoutPlan',
  'retention',
  'jbnr',
]

const SIMULATION_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'db2',
  'quotaStatus',
])
const CURRENT_DEFAULT_VISIBLE_COLUMNS = new Set([
  'cropRotation',
  'quotaStatus',
  'udledningskvoteMarkKgn',
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
        return [id, typeof value === 'boolean' ? value : defaults[id]]
      }),
    )
  } catch {
    return defaults
  }
}

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

const GROUP_BY_CATCHMENT_STORAGE_KEY = 'plantperform.farmGroupByCatchment'

export const readStoredGroupByCatchment = (): boolean => {
  try {
    return window.localStorage.getItem(GROUP_BY_CATCHMENT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const storeGroupByCatchment = (value: boolean) => {
  try {
    window.localStorage.setItem(GROUP_BY_CATCHMENT_STORAGE_KEY, value ? '1' : '0')
  } catch {
    return
  }
}
