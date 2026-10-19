import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ConfirmDialogProps = {
  name: string | null
  title?: string
  description: string
  confirmLabel: string
  destructive?: boolean
  children?: ReactNode
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export const ConfirmDialog = ({
  name,
  title,
  description,
  confirmLabel,
  destructive = true,
  children,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) => (
  <Dialog open={name !== null} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title ?? `Slet ${name}?`}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Annuller</Button>
        </DialogClose>
        <DialogClose asChild>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)
