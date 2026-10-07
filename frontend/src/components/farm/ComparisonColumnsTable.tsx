import type { ReactNode } from 'react'

import {
  figureCellClass,
  HIGHLIGHT_HEAD_CLASS,
  highlightHandlers,
  HISTORY_HEAD_CLASS,
  LABEL_CELL_CLASS,
  TABLE_HEAD_CLASS,
  type ComparedColumn,
  type OnHighlight,
} from '@/components/farm/comparison-column'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type ComparedColumnsProps = {
  columns: ComparedColumn[]
  highlightedKey: string | null
  onHighlight: OnHighlight
}

type ComparisonColumnsTableProps = ComparedColumnsProps & {
  label?: ReactNode
  children: ReactNode
}

export const ComparisonColumnsTable = ({
  label,
  columns,
  highlightedKey,
  onHighlight,
  children,
}: ComparisonColumnsTableProps) => (
  <Table containerClassName="rounded-lg border bg-card" className="table-fixed">
    <colgroup>
      <col className="w-56" />
      {columns.map((column) => (
        <col key={column.key} />
      ))}
    </colgroup>
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {label ? (
          <TableHead
            className={cn(
              'h-auto px-4.5 py-2.5 align-bottom text-xs font-normal text-muted-foreground',
              TABLE_HEAD_CLASS,
            )}
          >
            {label}
          </TableHead>
        ) : (
          <TableCell className={TABLE_HEAD_CLASS} />
        )}
        {columns.map((column) => (
          <TableHead
            key={column.key}
            scope="col"
            className={cn(
              'h-auto border-l border-border/60 px-4 py-2.5 align-top font-normal whitespace-normal transition-colors duration-120',
              column.history
                ? HISTORY_HEAD_CLASS
                : column.key === highlightedKey
                  ? HIGHLIGHT_HEAD_CLASS
                  : TABLE_HEAD_CLASS,
            )}
            {...highlightHandlers(column.key, onHighlight)}
          >
            <span className="block font-display text-[17px] leading-tight">
              {column.title}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {column.history ? 'Udgangspunkt' : column.subtitle}
            </span>
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>{children}</TableBody>
  </Table>
)

type ComparisonFigureRowProps = ComparedColumnsProps & {
  label: ReactNode
  note?: string | null
  children: (column: ComparedColumn, index: number) => ReactNode
}

export const ComparisonFigureRow = ({
  label,
  note,
  columns,
  highlightedKey,
  onHighlight,
  children,
}: ComparisonFigureRowProps) => (
  <TableRow className="border-border/60 hover:bg-transparent">
    <TableHead scope="row" className={cn(LABEL_CELL_CLASS, 'py-3 text-[13px]')}>
      {label}
      {note ? (
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {note}
        </span>
      ) : null}
    </TableHead>
    {columns.map((column, index) => (
      <TableCell
        key={column.key}
        className={cn(figureCellClass(column, highlightedKey), 'py-2.5')}
        {...highlightHandlers(column.key, onHighlight)}
      >
        {children(column, index)}
      </TableCell>
    ))}
  </TableRow>
)
