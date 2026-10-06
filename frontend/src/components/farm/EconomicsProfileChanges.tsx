import { Undo2 } from 'lucide-react'
import { useId } from 'react'

import { AppTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import {
  formatNameList,
  profileChangesTitle,
  type ProfileChange,
} from '@/lib/economics'
import { cn } from '@/lib/utils'

type EconomicsProfileChangesProps = {
  changes: ProfileChange[]
  stacked?: boolean
  className?: string
  onRestore: (change: ProfileChange) => void
  onRestoreAll: () => void
}

export const EconomicsProfileChanges = ({
  changes,
  stacked = false,
  className,
  onRestore,
  onRestoreAll,
}: EconomicsProfileChangesProps) => {
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className={className}>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          {profileChangesTitle(changes.length)}
        </h2>
        {changes.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onRestoreAll}
          >
            <Undo2 aria-hidden="true" />
            Gendan alt
          </Button>
        ) : null}
      </div>
      <ul>
        {changes.map((change) => (
          <li
            key={change.key}
            className={cn(
              'grid items-center gap-3 border-t px-5 py-2.5 text-[13px]',
              stacked
                ? 'grid-cols-[minmax(0,1fr)_auto_1.75rem]'
                : 'grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto_1.75rem]',
            )}
          >
            {stacked ? (
              <span className="min-w-0">
                <span className="block font-medium">{change.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatNameList(change.cropNames)}
                </span>
              </span>
            ) : (
              <>
                <span className="text-muted-foreground">
                  {formatNameList(change.cropNames)}
                </span>
                <span className="font-medium">{change.label}</span>
              </>
            )}
            <span className="text-right tabular-nums">
              <span className="text-muted-foreground">{change.from} → </span>
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold">
                {change.to}
              </span>
            </span>
            <AppTooltip content="Gendan standard">
              <button
                type="button"
                aria-label={`Gendan standard for ${change.label}`}
                className="inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => onRestore(change)}
              >
                <Undo2 className="size-3.5" aria-hidden="true" />
              </button>
            </AppTooltip>
          </li>
        ))}
      </ul>
    </section>
  )
}
