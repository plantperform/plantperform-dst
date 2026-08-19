export type FieldsSortKey =
  | 'name'
  | 'areaHa'
  | 'db2'
  | 'nLoad'
  | 'leaching'
  | 'fen'
  | 'nQuotaKgN'
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
