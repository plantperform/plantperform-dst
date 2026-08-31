import type { FieldRecord } from '@/api/types'
import type {
  FieldsSortDirection,
  FieldsSortState,
} from '@/components/farm/field-list-state'

const nameCollator = new Intl.Collator('da-DK', {
  numeric: true,
  sensitivity: 'base',
})
const idCollator = new Intl.Collator('da-DK', { sensitivity: 'base' })

const compareNullableNumber = (
  left: number | null,
  right: number | null,
  direction: FieldsSortDirection,
) => {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'asc' ? left - right : right - left
}

const compareNumber = (
  left: number,
  right: number,
  direction: FieldsSortDirection,
) => (direction === 'asc' ? left - right : right - left)

const compareName = (
  left: string,
  right: string,
  direction: FieldsSortDirection,
) => {
  const result = nameCollator.compare(left, right)
  return direction === 'asc' ? result : -result
}

const comparePrimary = (
  left: FieldRecord,
  right: FieldRecord,
  sort: FieldsSortState,
) => {
  switch (sort.key) {
    case 'name':
      return compareName(left.name, right.name, sort.direction)
    case 'areaHa':
      return compareNumber(left.areaHa, right.areaHa, sort.direction)
    case 'db2':
      return compareNumber(left.db2, right.db2, sort.direction)
    case 'nLoad':
      return compareNumber(left.nLoad, right.nLoad, sort.direction)
    case 'leaching':
      return compareNumber(left.leaching, right.leaching, sort.direction)
    case 'fen':
      return compareNumber(left.fen, right.fen, sort.direction)
    case 'udledningskvoteMarkKgn':
      return compareNullableNumber(
        left.udledningskvoteMarkKgn,
        right.udledningskvoteMarkKgn,
        sort.direction,
      )
    case 'inTakeoutPlan':
      return compareNumber(
        Number(left.inTakeoutPlan),
        Number(right.inTakeoutPlan),
        sort.direction,
      )
    case 'retention':
      return compareNullableNumber(
        left.retention,
        right.retention,
        sort.direction,
      )
    case 'jbnr':
      return compareNullableNumber(left.jbnr, right.jbnr, sort.direction)
  }
}

export const compareFields = (
  left: FieldRecord,
  right: FieldRecord,
  sort: FieldsSortState,
) => {
  const primary = comparePrimary(left, right, sort)
  if (primary !== 0) return primary
  const imkTie = compareNullableNumber(left.imkId, right.imkId, 'asc')
  if (imkTie !== 0) return imkTie
  return idCollator.compare(left.id, right.id)
}
