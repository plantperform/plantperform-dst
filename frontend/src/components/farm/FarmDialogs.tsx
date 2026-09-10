import { UserPlus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { farmMembersKey, farmsKey, useFarmMembers } from '@/api/hooks'
import { addFarmMember, deleteFarm, removeFarmMember } from '@/api/mutations'
import type { Farm } from '@/api/types'
import { useAuth } from '@/auth/context'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'

type FarmDialogProps = {
  farm: Farm
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}

export const ShareFarmDialog = ({
  farm,
  open,
  onOpenChange,
  onError,
}: FarmDialogProps) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: members = [], isLoading } = useFarmMembers(
    open ? farm.id : undefined,
  )
  const [memberEmail, setMemberEmail] = useState('')
  const [isSharing, setIsSharing] = useState(false)
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)
  const ownEmail = user?.email.toLowerCase() ?? ''
  const isLastMember = members.length <= 1

  const shareFarm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = memberEmail.trim().toLowerCase()
    if (!email.includes('@')) {
      onError('Indtast en gyldig e-mailadresse.')
      return
    }
    if (members.some((member) => member.email.toLowerCase() === email)) {
      onError('Brugeren har allerede adgang til bedriften.')
      return
    }
    setIsSharing(true)
    try {
      await addFarmMember(farm.id, email)
      await mutate(farmMembersKey(farm.id))
      setMemberEmail('')
      onError(null)
    } catch {
      onError(
        'Kunne ikke dele bedriften. Brugeren skal have en bekræftet konto.',
      )
    } finally {
      setIsSharing(false)
    }
  }

  const revokeMember = async (email: string) => {
    if (isLastMember) return
    setRemovingEmail(email)
    try {
      await removeFarmMember(farm.id, email)
      await mutate(farmMembersKey(farm.id))
      onError(null)
      if (email.toLowerCase() === ownEmail) {
        await mutate(farmsKey)
        navigate('/', { state: HOME_OVERVIEW_STATE })
      }
    } catch {
      onError('Kunne ikke fjerne brugeren fra bedriften.')
    } finally {
      setRemovingEmail(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Del {farm.name}</DialogTitle>
          <DialogDescription>
            Alle med adgang kan det samme: se marker, oprette simuleringer og
            dele bedriften videre.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Har adgang
            </p>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">
                Henter medlemmer...
              </p>
            ) : null}
            <ul className="divide-y rounded-md border">
              {members.map((member) => {
                const isSelf = member.email.toLowerCase() === ownEmail
                return (
                  <li
                    key={member.email}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{member.email}</span>
                      {isSelf ? (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                          dig
                        </span>
                      ) : null}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="shrink-0 gap-1 text-muted-foreground hover:text-destructive"
                      disabled={isLastMember || removingEmail === member.email}
                      title={
                        isLastMember
                          ? 'Den sidste med adgang kan ikke fjernes'
                          : isSelf
                            ? 'Forlad bedriften'
                            : `Fjern ${member.email}`
                      }
                      onClick={() => void revokeMember(member.email)}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                      {isSelf ? 'Forlad' : 'Fjern'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
          <form
            className="space-y-2"
            onSubmit={(event) => void shareFarm(event)}
          >
            <Label htmlFor="share-farm-email">Del med</Label>
            <div className="flex gap-2">
              <Input
                id="share-farm-email"
                type="email"
                autoComplete="off"
                placeholder="navn@eksempel.dk"
                value={memberEmail}
                onChange={(event) => setMemberEmail(event.target.value)}
              />
              <Button type="submit" className="gap-1.5" disabled={isSharing}>
                <UserPlus className="size-4" aria-hidden="true" />
                {isSharing ? 'Deler...' : 'Del'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Brugeren skal have en bekræftet konto i PlantPerform.
            </p>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export const DeleteFarmDialog = ({
  farm,
  open,
  onOpenChange,
  onError,
}: FarmDialogProps) => {
  const navigate = useNavigate()
  const [confirmation, setConfirmation] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const canDelete =
    confirmation.trim().toLowerCase() === farm.name.trim().toLowerCase()

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) setConfirmation('')
    onOpenChange(nextOpen)
  }

  const confirmDelete = async () => {
    if (!canDelete) return
    setIsDeleting(true)
    try {
      await deleteFarm(farm.id)
      await mutate(farmsKey)
      onError(null)
      navigate('/', { state: HOME_OVERVIEW_STATE })
    } catch {
      onError('Kunne ikke slette bedriften.')
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
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annuller</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={!canDelete || isDeleting}
            onClick={() => void confirmDelete()}
          >
            {isDeleting ? 'Sletter...' : 'Slet bedrift'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
