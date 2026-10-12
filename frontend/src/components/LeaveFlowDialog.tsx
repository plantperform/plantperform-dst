import type { ReactNode } from 'react'
import type { Blocker } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type LeaveFlowDialogProps = {
  blocker: Blocker
  title: string
  description: ReactNode
}

export const LeaveFlowDialog = ({
  blocker,
  title,
  description,
}: LeaveFlowDialogProps) => (
  <Dialog
    open={blocker.state === 'blocked'}
    onOpenChange={(open) => {
      if (!open) blocker.reset?.()
    }}
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => blocker.proceed?.()}>
          Forlad uden at gemme
        </Button>
        <Button autoFocus onClick={() => blocker.reset?.()}>
          Bliv på siden
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)
