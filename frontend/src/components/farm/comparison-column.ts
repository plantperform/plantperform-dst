import type { FieldRecord } from '@/api/types'
import type {
  CatchmentTotalsByYear,
  CropShare,
  FieldTotals,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

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
  cropShares: CropShare[] | undefined
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
export const BEST_TEXT_CLASS = 'text-success-strong'
export const HIGHLIGHT_CELL_CLASS = 'bg-[#F3F3EF]'
export const HIGHLIGHT_HEAD_CLASS = 'bg-[#EFEFEA]'

export type OnHighlight = (key: string | null) => void

export const columnCellClass = (
  column: Pick<ComparedColumn, 'key' | 'history'>,
  highlightedKey: string | null,
): string | undefined => {
  if (column.history) return HISTORY_CELL_CLASS
  return column.key === highlightedKey ? HIGHLIGHT_CELL_CLASS : undefined
}

export const LABEL_CELL_CLASS =
  'h-auto px-4.5 align-top font-normal whitespace-normal text-foreground'

export const figureCellClass = (
  column: Pick<ComparedColumn, 'key' | 'history'>,
  highlightedKey: string | null,
): string =>
  cn(
    'border-l border-border/60 px-4 align-top whitespace-normal transition-colors duration-120',
    columnCellClass(column, highlightedKey),
  )

export const highlightHandlers = (key: string, onHighlight: OnHighlight) => ({
  onMouseEnter: () => onHighlight(key),
  onMouseLeave: () => onHighlight(null),
})
