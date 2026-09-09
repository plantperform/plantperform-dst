import { ChevronLeft, ChevronRight, Locate, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { mutate } from 'swr'

import { farmFieldsKey, farmKey } from '@/api/hooks'
import { detachField } from '@/api/mutations'
import type {
  FieldRecord,
  RotationCandidateYearResult,
  Simulation,
} from '@/api/types'
import { MarkPanel } from '@/components/farm/MarkPanel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type FieldDetailPanelProps = {
  farmId: string
  field: FieldRecord
  sortedFields: FieldRecord[]
  isSimulationView: boolean
  simulationId?: string
  simulation?: Simulation
  selectedYearIndex?: number | null
  onSelectedYearIndexChange?: (index: number | null) => void
  yearValues?: RotationCandidateYearResult[]
  listBehind: boolean
  mapVisible: boolean
  onSelectFieldId: (fieldId: string) => void
  onClose: () => void
  onZoomToField: (fieldId: string) => void
  onCalcOpenChange?: (open: boolean) => void
  onError: (message: string | null) => void
}

export const FieldDetailPanel = ({
  farmId,
  field,
  sortedFields,
  isSimulationView,
  simulationId,
  simulation,
  selectedYearIndex = null,
  onSelectedYearIndexChange,
  yearValues,
  listBehind,
  mapVisible,
  onSelectFieldId,
  onClose,
  onZoomToField,
  onCalcOpenChange,
  onError,
}: FieldDetailPanelProps) => {
  const [detachingFieldId, setDetachingFieldId] = useState<string | null>(null)
  const [confirmDetachField, setConfirmDetachField] =
    useState<FieldRecord | null>(null)

  const detachFarmField = useCallback(
    async (fieldId: string) => {
      setDetachingFieldId(fieldId)
      try {
        await detachField(farmId, fieldId)
        await mutate(farmFieldsKey(farmId))
        await mutate(farmKey(farmId))
        onError(null)
      } catch {
        onError('Kunne ikke fjerne marken fra bedriften.')
      } finally {
        setDetachingFieldId(null)
      }
    },
    [farmId, onError],
  )

  const position = sortedFields.findIndex(
    (candidate) => candidate.id === field.id,
  )
  const previousField = position > 0 ? sortedFields[position - 1] : null
  const nextField =
    position >= 0 && position < sortedFields.length - 1
      ? sortedFields[position + 1]
      : null

  const goToPrevious = () => {
    if (previousField) onSelectFieldId(previousField.id)
  }
  const goToNext = () => {
    if (nextField) onSelectFieldId(nextField.id)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest('[role="dialog"]')) return
      const next = event.key === 'ArrowUp' ? previousField : nextField
      if (!next) return
      event.preventDefault()
      onSelectFieldId(next.id)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previousField, nextField, onSelectFieldId])

  return (
    <div
      className="@container flex h-full min-h-0 flex-col bg-card"
      role="complementary"
      aria-label={`Markdetaljer: ${field.name}`}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4 @2xl:px-6">
        {listBehind ? (
          <Button
            variant="ghost"
            size="xs"
            className="-ml-2 gap-1 px-2 text-primary hover:text-primary"
            onClick={onClose}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Liste
          </Button>
        ) : null}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {position >= 0 ? position + 1 : 0} af {sortedFields.length}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="size-7 p-0 text-muted-foreground"
            onClick={goToPrevious}
            disabled={previousField === null}
            aria-label="Forrige mark"
            title="Forrige mark (Alt+Pil op)"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="size-7 p-0 text-muted-foreground"
            onClick={goToNext}
            disabled={nextField === null}
            aria-label="Næste mark"
            title="Næste mark (Alt+Pil ned)"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {mapVisible ? (
            <Button
              variant="outline"
              size="xs"
              className="gap-1.5"
              onClick={() => onZoomToField(field.id)}
            >
              <Locate className="size-4" aria-hidden="true" />
              Zoom til mark
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            className="size-8 p-0 text-muted-foreground"
            onClick={onClose}
            aria-label="Luk panel"
            title="Luk panel"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <MarkPanel
        key={field.id}
        farmId={farmId}
        field={field}
        isSimulationView={isSimulationView}
        simulationId={simulationId}
        simulation={simulation}
        selectedYearIndex={selectedYearIndex}
        onSelectedYearIndexChange={onSelectedYearIndexChange}
        yearValues={yearValues}
        isDetaching={detachingFieldId === field.id}
        onRequestDetach={() => setConfirmDetachField(field)}
        onCalcOpenChange={onCalcOpenChange}
        onError={onError}
      />

      <Dialog
        open={confirmDetachField !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDetachField(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fjern mark?</DialogTitle>
            <DialogDescription>
              Marken {confirmDetachField?.name} fjernes fra bedriften. Det
              ændrer ikke registret.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDetachField(null)}
            >
              Annuller
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const fieldToDetach = confirmDetachField
                setConfirmDetachField(null)
                if (fieldToDetach) void detachFarmField(fieldToDetach.id)
              }}
            >
              Fjern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
