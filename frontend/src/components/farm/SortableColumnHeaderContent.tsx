import type { Column, SortDirection } from '@tanstack/react-table'

import type { FieldRecord } from '@/api/types'
import { cn } from '@/lib/utils'

type SortHeaderButtonProps = {
  label: string
  unit?: string
  align?: 'left' | 'right'
  sorted: false | SortDirection
  onToggle: () => void
}

export const SortHeaderButton = ({
  label,
  unit,
  align = 'left',
  sorted,
  onToggle,
}: SortHeaderButtonProps) => {
  const glyph = sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        '-mx-1 flex w-full items-start gap-1 rounded px-1 py-0.5 text-left whitespace-nowrap hover:text-foreground',
        align === 'right' && 'justify-end text-right',
        sorted && 'text-foreground',
      )}
    >
      <span className="flex flex-col">
        <span>{label}</span>
        {unit ? (
          <span className="text-[11px] leading-4 font-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
      {glyph ? (
        <span aria-hidden="true" className="text-[10px] leading-4">
          {glyph}
        </span>
      ) : null}
    </button>
  )
}

export const SortableColumnHeaderContent = ({
  label,
  unit,
  align,
  column,
}: {
  label: string
  unit?: string
  align?: 'left' | 'right'
  column: Column<FieldRecord, unknown>
}) => {
  const sorted = column.getIsSorted()
  return (
    <SortHeaderButton
      label={label}
      unit={unit}
      align={align}
      sorted={sorted}
      onToggle={() => column.toggleSorting(sorted === 'asc')}
    />
  )
}
