export type FieldsSortKey =
  | 'name'
  | 'areaHa'
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
