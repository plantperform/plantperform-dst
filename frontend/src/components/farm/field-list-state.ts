export type FieldsSortKey =
  | 'name'
  | 'areaHa'
  | 'cropRotation'
  | 'db2'
  | 'nLoad'
  | 'leaching'
  | 'nQuotaKgN'
  | 'inTakeoutPlan'
  | 'retention'
  | 'soil'

export type FieldsSortDirection = 'asc' | 'desc'

export type FieldsSortState = {
  key: FieldsSortKey
  direction: FieldsSortDirection
}

export const DEFAULT_FIELDS_SORT: FieldsSortState = {
  key: 'name',
  direction: 'asc',
}
