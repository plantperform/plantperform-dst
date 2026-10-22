import { useState } from 'react'

import type { FieldRecord } from '@/api/types'
import { FieldRowList } from '@/components/farm/FieldRowList'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fieldTitle, formatFieldCount } from '@/lib/field-domain'

type DetachFieldsDialogProps = {
  fields: FieldRecord[]
  isSimulationView: boolean
  onCancel: () => void
  onConfirm: () => void
}

const describeDetach = (single: boolean, isSimulationView: boolean) => {
  const subject = single ? 'Marken' : 'Markerne'
  return isSimulationView
    ? `${subject} fjernes kun fra simuleringen. Bedriften beholder ${single ? 'den' : 'dem'}.`
    : `${subject} fjernes fra bedriften. Registret ændres ikke. Simuleringer, der allerede er oprettet, beholder deres marker.`
}

export const DetachFieldsDialog = ({
  fields,
  isSimulationView,
  onCancel,
  onConfirm,
}: DetachFieldsDialogProps) => {
  const [shownFields, setShownFields] = useState(fields)
  if (fields.length > 0 && fields !== shownFields) {
    setShownFields(fields)
  }
  const single = shownFields.length === 1 ? shownFields[0] : null

  return (
    <Dialog
      open={fields.length > 0}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {single
              ? `Fjern mark ${single.name}?`
              : `Fjern ${formatFieldCount(shownFields.length)}?`}
          </DialogTitle>
          <DialogDescription>
            {describeDetach(single !== null, isSimulationView)}
          </DialogDescription>
        </DialogHeader>
        {single ? null : (
          <FieldRowList
            rows={shownFields.map((field) => ({
              key: field.id,
              label: fieldTitle(field),
              areaHa: field.areaHa,
            }))}
            className="max-h-48"
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Annuller
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {single
              ? 'Fjern mark'
              : `Fjern ${formatFieldCount(shownFields.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
