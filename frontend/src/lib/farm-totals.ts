import type { FieldRecord } from '@/api/types'

export type FieldTotals = {
  area: number
  db2: number
  nLoad: number
  leaching: number
}

export const getFieldTotals = (fields: FieldRecord[]): FieldTotals => ({
  area: fields.reduce((sum, field) => sum + field.areaHa, 0),
  db2: fields.reduce((sum, field) => sum + field.db2, 0),
  nLoad: fields.reduce((sum, field) => sum + field.nLoad, 0),
  leaching: fields.reduce((sum, field) => sum + field.leaching, 0),
})

export const formatNumber = (value: number) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 }).format(value)

export const formatFieldCount = (count: number) =>
  `${count} ${count === 1 ? 'mark' : 'marker'}`

export const formatRelativeTime = (value: string) => {
  const createdAt = new Date(value).getTime()
  if (Number.isNaN(createdAt)) return 'oprettet for nylig'

  const diffMinutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000))
  if (diffMinutes < 1) return 'oprettet netop nu'
  if (diffMinutes < 60) return `oprettet for ${diffMinutes} min. siden`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `oprettet for ${diffHours} t. siden`

  const diffDays = Math.round(diffHours / 24)
  return `oprettet for ${diffDays} d. siden`
}
