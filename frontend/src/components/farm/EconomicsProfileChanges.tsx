import { Undo2 } from 'lucide-react'
import { useId } from 'react'

import { ChangedValue, RestoreButton } from '@/components/farm/economics-ui'
import { Button } from '@/components/ui/button'
import {
  formatNameList,
  profileChangesTitle,
  type ProfileChange,
} from '@/lib/economics'

type EconomicsProfileChangesProps = {
  changes: ProfileChange[]
  className?: string
  onRestore: (change: ProfileChange) => void
  onRestoreAll: () => void
}

export const EconomicsProfileChanges = ({
  changes,
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
        {changes.map((change) => {
          const crops = formatNameList(change.cropNames)
          return (
            <li
              key={change.key}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t px-5 py-2.5 text-[13px]"
            >
              <span className="min-w-0">
                <span className="block font-medium">{change.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {crops}
                </span>
              </span>
              <span className="text-right tabular-nums">
                <span className="text-muted-foreground">{change.from} → </span>
                <ChangedValue>{change.to}</ChangedValue>
              </span>
              <RestoreButton
                label={`${change.label} for ${crops}`}
                onRestore={() => onRestore(change)}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
