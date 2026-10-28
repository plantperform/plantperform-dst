import type { FieldRecord } from '@/api/types'
import type {
  FieldsSortDirection,
  FieldsSortState,
} from '@/components/farm/field-list-state'
import { fieldDisplayName, fieldNNormPct, perHa } from '@/lib/field-domain'

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

const compareNullableName = (
  left: string | null,
  right: string | null,
  direction: FieldsSortDirection,
) => {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return compareName(left, right, direction)
}

// The crop the list shows for the selected year; none until a year is chosen.
const selectedYearCrop = (
  field: FieldRecord,
  selectedYearIndex: number | null,
) =>
  selectedYearIndex === null ? undefined : field.cropRotation[selectedYearIndex]

export type CatchmentLabel = (catchmentId: number | null) => string

const compareCatchment = (
  left: number | null,
  right: number | null,
  direction: FieldsSortDirection,
  catchmentLabel?: CatchmentLabel,
) => {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  if (!catchmentLabel) return compareNumber(left, right, direction)
  return compareName(catchmentLabel(left), catchmentLabel(right), direction)
}

const comparePrimary = (
  left: FieldRecord,
  right: FieldRecord,
  sort: FieldsSortState,
  catchmentLabel?: CatchmentLabel,
  selectedYearIndex: number | null = null,
) => {
  switch (sort.key) {
    case 'name':
      return compareName(fieldDisplayName(left), fieldDisplayName(right), sort.direction)
    case 'areaHa':
      return compareNumber(left.areaHa, right.areaHa, sort.direction)
    case 'cropCode':
      return compareNullableNumber(
        selectedYearCrop(left, selectedYearIndex)?.cropCode ?? null,
        selectedYearCrop(right, selectedYearIndex)?.cropCode ?? null,
        sort.direction,
      )
    case 'cropYear':
      return compareNullableName(
        selectedYearCrop(left, selectedYearIndex)?.cropName ?? null,
        selectedYearCrop(right, selectedYearIndex)?.cropName ?? null,
        sort.direction,
      )
    case 'catchment':
      return compareCatchment(
        left.catchmentId,
        right.catchmentId,
        sort.direction,
        catchmentLabel,
      )
    case 'nNormPct':
      return compareNullableNumber(
        fieldNNormPct(left),
        fieldNNormPct(right),
        sort.direction,
      )
    case 'nLoad':
    case 'leaching':
      return compareNullableNumber(
        left.quotaEligible ? perHa(left[sort.key], left.areaHa) : null,
        right.quotaEligible ? perHa(right[sort.key], right.areaHa) : null,
        sort.direction,
      )
    case 'db2':
    case 'feedUnits':
      return compareNullableNumber(
        sort.key === 'db2' && left.economicsMissing
          ? null
          : perHa(left[sort.key], left.areaHa),
        sort.key === 'db2' && right.economicsMissing
          ? null
          : perHa(right[sort.key], right.areaHa),
        sort.direction,
      )
    case 'nLoadQuotaKgN':
      return compareNullableNumber(
        left.nLoadQuotaKgN,
        right.nLoadQuotaKgN,
        sort.direction,
      )
    case 'inTakeoutPlan':
      return compareNumber(
        left.inTakeoutPlan === 'nej' ? 0 : 1,
        right.inTakeoutPlan === 'nej' ? 0 : 1,
        sort.direction,
      )
    case 'retention':
      return compareNullableNumber(
        left.retention,
        right.retention,
        sort.direction,
      )
    case 'soilTypeNumber':
      return compareNullableNumber(
        left.soilTypeNumber,
        right.soilTypeNumber,
        sort.direction,
      )
  }
}

export const compareFields = (
  left: FieldRecord,
  right: FieldRecord,
  sort: FieldsSortState,
  catchmentLabel?: CatchmentLabel,
  selectedYearIndex: number | null = null,
) => {
  const primary = comparePrimary(
    left,
    right,
    sort,
    catchmentLabel,
    selectedYearIndex,
  )
  if (primary !== 0) return primary
  const imkTie = compareNullableNumber(left.imkId, right.imkId, 'asc')
  if (imkTie !== 0) return imkTie
  return idCollator.compare(left.id, right.id)
}
