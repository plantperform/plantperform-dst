import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { farmsKey } from '@/api/hooks'
import { deleteFarm } from '@/api/mutations'
import type { Farm } from '@/api/types'
import { useToast } from '@/components/toast'
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
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatNameList } from '@/lib/economics'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'

type DeleteFarmDialogProps = {
  farm: Farm
  sharedWith: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const DeleteFarmDialog = ({
  farm,
  sharedWith,
  open,
  onOpenChange,
}: DeleteFarmDialogProps) => {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [confirmation, setConfirmation] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [failed, setFailed] = useState(false)
  const canDelete =
    confirmation.trim().toLowerCase() === farm.name.trim().toLowerCase()

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      setConfirmation('')
      setFailed(false)
    }
    onOpenChange(nextOpen)
  }

  const confirmDelete = async () => {
    if (!canDelete) return
    setIsDeleting(true)
    setFailed(false)
    try {
      await deleteFarm(farm.id)
      await mutate(farmsKey)
      showToast(`${farm.name} er slettet`)
      navigate('/', { state: HOME_OVERVIEW_STATE })
    } catch {
      setFailed(true)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Slet {farm.name}?</DialogTitle>
          <DialogDescription>
            Bedriften, alle dens marker og alle simuleringer slettes for alle,
            der har adgang. Det kan ikke fortrydes.
          </DialogDescription>
          {sharedWith.length > 0 ? (
            <p className="text-sm">
              Bedriften er delt med {formatNameList(sharedWith)}.
            </p>
          ) : null}
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            void confirmDelete()
          }}
        >
          <Label htmlFor="delete-farm-confirmation">
            Skriv bedriftens navn for at bekræfte
          </Label>
          <Input
            id="delete-farm-confirmation"
            autoComplete="off"
            placeholder={farm.name}
            value={confirmation}
            aria-describedby={failed ? 'delete-farm-error' : undefined}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <FieldError
            id="delete-farm-error"
            message={failed ? 'Kunne ikke slette bedriften.' : null}
          />
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annuller</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={!canDelete}
            loading={isDeleting}
            onClick={() => void confirmDelete()}
          >
            {isDeleting ? 'Sletter...' : 'Slet bedrift'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
