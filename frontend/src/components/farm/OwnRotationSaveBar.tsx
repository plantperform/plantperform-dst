import { Circle, CircleCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  describeChangeCount,
  describeSavedAt,
  type CreationStep,
} from '@/lib/own-rotations'
import { cn } from '@/lib/utils'

type SaveStatusProps = {
  isNew: boolean
  changed: boolean
  changeCount: number
  locked: boolean
  checklist: CreationStep[]
  savedAt: string | null
  failure: string | null
}

const SaveStatus = ({
  isNew,
  changed,
  changeCount,
  locked,
  checklist,
  savedAt,
  failure,
}: SaveStatusProps) => {
  if (failure) {
    return (
      <p role="alert" className="text-destructive">
        {failure}
      </p>
    )
  }
  const missing = checklist.filter((step) => !step.done)
  if (isNew || (changed && !locked && missing.length > 0)) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-muted-foreground">
          {isNew ? 'Før du kan oprette' : 'Før du kan gemme'}
        </span>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {(isNew ? checklist : missing).map((step) => (
            <li
              key={step.label}
              className={cn(
                'flex items-center gap-1.5',
                step.done ? 'text-muted-foreground' : 'font-semibold',
              )}
            >
              {step.done ? (
                <CircleCheck
                  className="size-4 text-success"
                  aria-hidden="true"
                />
              ) : (
                <Circle
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="sr-only">
                {step.done ? 'Klar:' : 'Mangler:'}
              </span>
              {step.label}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (changed) return <p>{describeChangeCount(changeCount)}</p>
  if (locked) return null
  return (
    <p className="flex items-center gap-2">
      <CircleCheck
        className="size-4 shrink-0 text-success"
        aria-hidden="true"
      />
      <span>
        <b className="font-semibold">Alt er gemt.</b>
        {savedAt ? (
          <span className="text-muted-foreground">
            {' '}
            {describeSavedAt(savedAt)}
          </span>
        ) : null}
      </span>
    </p>
  )
}

type OwnRotationSaveBarProps = SaveStatusProps & {
  formId: string
  editing: boolean
  saving: boolean
  canSave: boolean
  onCancel: () => void
  onUseInSimulation: (() => void) | null
}

export const OwnRotationSaveBar = ({
  formId,
  editing,
  saving,
  canSave,
  onCancel,
  onUseInSimulation,
  ...status
}: OwnRotationSaveBarProps) => (
  <footer
    className={cn(
      'sticky bottom-3 z-10 overflow-hidden rounded-lg border bg-card text-sm shadow-sm',
      status.changed && 'border-primary',
    )}
  >
    <div
      className={cn(
        'flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5',
        status.changed && 'bg-primary/5',
      )}
    >
      <div className="min-w-0 flex-1">
        <SaveStatus {...status} />
      </div>
      {status.isNew ? (
        <Button
          type="submit"
          form={formId}
          loading={saving}
          disabled={!canSave}
        >
          Opret sædskifte
        </Button>
      ) : editing ? (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onCancel}
          >
            Annuller
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={saving}
            disabled={!canSave}
          >
            Gem ændringer
          </Button>
        </>
      ) : onUseInSimulation ? (
        <Button type="button" variant="outline" onClick={onUseInSimulation}>
          Brug i en ny simulering
        </Button>
      ) : null}
    </div>
  </footer>
)
