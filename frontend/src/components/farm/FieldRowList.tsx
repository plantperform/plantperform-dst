import { Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

export type FieldRow = {
  key: string
  label: string
  areaHa: number | null
  onUndo?: () => void
}

type FieldRowListProps = {
  rows: FieldRow[]
  className?: string
}

export const FieldRowList = ({ rows, className }: FieldRowListProps) => (
  <ul
    className={cn(
      'divide-y overflow-y-auto rounded-md border text-sm',
      className,
    )}
  >
    {rows.map((row) => (
      <li
        key={row.key}
        className={cn(
          'flex items-center justify-between gap-3 pl-3',
          row.onUndo ? 'py-0.5 pr-0.5' : 'py-1.5 pr-3',
        )}
      >
        <span className="min-w-0 truncate">{row.label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {row.areaHa !== null ? (
            <span className="text-muted-foreground tabular-nums">
              {formatNumber(row.areaHa)} ha
            </span>
          ) : null}
          {row.onUndo ? (
            <Button
              variant="ghost"
              size="xs"
              className="size-7 p-0 text-muted-foreground"
              aria-label={`Fortryd ${row.label}`}
              title="Fortryd"
              onClick={row.onUndo}
            >
              <Undo2 className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </span>
      </li>
    ))}
  </ul>
)
