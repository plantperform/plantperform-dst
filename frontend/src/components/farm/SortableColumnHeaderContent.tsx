import type { Column } from '@tanstack/react-table'

import type { FieldRecord } from '@/api/types'
import { cn } from '@/lib/utils'

export const SortableColumnHeaderContent = ({
  label,
  unit,
  align = 'left',
  column,
}: {
  label: string
  unit?: string
  align?: 'left' | 'right'
  column: Column<FieldRecord, unknown>
}) => {
  const sorted = column.getIsSorted()
  const glyph = sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''
  const handleClick = () => {
    column.toggleSorting(sorted === 'asc')
  }

  return (
    <button
      type="button"
      onClick={handleClick}
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
