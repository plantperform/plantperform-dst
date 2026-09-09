import type { Column } from '@tanstack/react-table'

import type { FieldRecord } from '@/api/types'

export const SortableColumnHeaderContent = ({
  label,
  unit,
  column,
}: {
  label: string
  unit?: string
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
      className="-mx-1 flex w-full items-start gap-1 rounded px-1 py-0.5 text-left whitespace-nowrap hover:bg-muted/70"
    >
      <span className="flex flex-col">
        <span>{label}</span>
        {unit ? (
          <span className="text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
      {glyph ? (
        <span
          aria-hidden="true"
          className="text-xs leading-5 text-muted-foreground"
        >
          {glyph}
        </span>
      ) : null}
    </button>
  )
}
