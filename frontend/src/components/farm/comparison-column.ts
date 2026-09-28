import type { FieldRecord } from '@/api/types'
import type { CatchmentTotalsByYear, FieldTotals } from '@/lib/field-domain'

export type ComparedColumn = {
  key: string
  title: string
  subtitle: string
  history: boolean
  fields: FieldRecord[]
  totals: FieldTotals
  requirement: string | null
  changedCount: number | null
  catchments: CatchmentTotalsByYear | undefined
  partialQuotas: ReadonlyMap<number, number>
  retrying: boolean
  onRetry: () => void
  yearsOver: number | null
  catchmentsOver: number | null
}

export const columnFigure = (
  column: ComparedColumn,
  value: number,
): number | null => (column.totals.calculatedCount > 0 ? value : null)

export const completeFigure = (
  column: ComparedColumn,
  value: number | null,
): number | null => (column.totals.uncalculatedCount === 0 ? value : null)

export const HISTORY_CELL_CLASS = 'bg-[#F7F5EF]'
export const HISTORY_HEAD_CLASS = 'bg-[#F1EDE3]'
export const TABLE_HEAD_CLASS = 'bg-muted/30'
export const DETAIL_CLASS =
  'bg-[color:color-mix(in_oklab,var(--color-muted)_30%,var(--color-card))]'
export const BEST_TEXT_CLASS = 'text-green-700'
