import type { Column } from '@tanstack/react-table'

import type { FieldRecord } from '@/api/types'

export const SortableColumnHeaderContent = ({
  label,
  column,
}: {
  label: string
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
      className="-mx-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted/70"
    >
      <span>{label}</span>
      {glyph ? (
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          {glyph}
        </span>
      ) : null}
    </button>
  )
}
