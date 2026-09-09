import { ChevronLeft, ChevronRight, Locate } from 'lucide-react'
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
  overlay: boolean
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
  overlay,
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
      className="flex h-full min-h-0 flex-col bg-card"
      role="complementary"
      aria-label={`Markdetaljer: ${field.name}`}
    >
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {overlay && listBehind ? (
          <Button
            variant="ghost"
            size="xs"
            className="-ml-2 gap-1 px-2 text-muted-foreground"
            onClick={onClose}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Liste
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {position >= 0 ? position + 1 : 0} af {sortedFields.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            className="px-2"
            onClick={goToPrevious}
            disabled={previousField === null}
            aria-label="Forrige mark"
            title="Forrige mark (Alt+Pil op)"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="px-2"
            onClick={goToNext}
            disabled={nextField === null}
            aria-label="Næste mark"
            title="Næste mark (Alt+Pil ned)"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          {mapVisible ? (
            <Button
              variant="outline"
              size="xs"
              className="gap-1.5"
              onClick={() => onZoomToField(field.id)}
            >
              <Locate className="h-3.5 w-3.5" aria-hidden="true" />
              Zoom til mark
            </Button>
          ) : null}
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
        onClose={onClose}
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
