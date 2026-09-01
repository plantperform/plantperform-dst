import { ChevronLeft, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { farmFieldsKey, farmMembersKey, useFarmMembers } from '@/api/hooks'
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

type FarmTopBarProps = {
  farm: Farm
  onError: (message: string | null) => void
}

/**
 * Identity of, and actions on, the bedrift itself. Everything here acts on the
 * whole bedrift, which is what puts it above the sidebar: the visninger in the
 * sidebar belong to the bedrift named here.
 */
export const FarmTopBar = ({ farm, onError }: FarmTopBarProps) => {
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-3">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/">
          <ChevronLeft className="size-4" />
          Bedrifter
        </Link>
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {farm.name}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {farm.ownerName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            CVR {farm.cvr ?? '—'}
          </p>
        </div>
      </div>

      <FarmActionsMenu
        onShare={() => setShareOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />

      <ShareFarmDialog
        farm={farm}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onError={onError}
      />
      <DeleteFarmDialog
        farm={farm}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onError={onError}
      />
    </header>
  )
}

type FarmActionsMenuProps = {
  onShare: () => void
  onDelete: () => void
}

const FarmActionsMenu = ({ onShare, onDelete }: FarmActionsMenuProps) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const runAction = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Handlinger for bedriften"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-md border bg-background py-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => runAction(onShare)}
          >
            Del bedrift
          </button>
          <div className="my-1 border-t" />
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => runAction(onDelete)}
          >
            Slet bedrift
          </button>
        </div>
      ) : null}
    </div>
  )
}

type FarmDialogProps = {
  farm: Farm
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}

const ShareFarmDialog = ({
  farm,
  open,
  onOpenChange,
  onError,
}: FarmDialogProps) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: members = [], isLoading } = useFarmMembers(farm.id)
  const [memberEmail, setMemberEmail] = useState('')
  const [isSharing, setIsSharing] = useState(false)

  const shareFarm = async () => {
    const email = memberEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      onError('Indtast en gyldig e-mailadresse.')
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
    if (members.length <= 1) return
    try {
      await removeFarmMember(farm.id, email)
      await mutate(farmMembersKey(farm.id))
      if (user?.email.toLowerCase() === email.toLowerCase()) {
        await mutate('/farms')
        navigate('/')
      }
      onError(null)
    } catch {
      onError('Kunne ikke fjerne brugeren fra bedriften.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Del bedrift</DialogTitle>
          <DialogDescription>
            Alle medlemmer har samme adgang og kan selv dele bedriften videre.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              Indlæser medlemmer...
            </p>
          ) : null}
          {members.map((member) => (
            <div
              key={member.email}
              className="flex items-center justify-between gap-3 rounded border p-2 text-sm"
            >
              <span className="truncate">{member.email}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={members.length <= 1}
                onClick={() => void revokeMember(member.email)}
              >
                Fjern
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="bruger@example.com"
              value={memberEmail}
              onChange={(event) => setMemberEmail(event.target.value)}
            />
            <Button onClick={() => void shareFarm()} disabled={isSharing}>
              {isSharing ? '...' : 'Del'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const DeleteFarmDialog = ({
  farm,
  open,
  onOpenChange,
  onError,
}: FarmDialogProps) => {
  const navigate = useNavigate()
  const [isDeleting, setIsDeleting] = useState(false)

  const confirmDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteFarm(farm.id)
      await mutate('/farms')
      await mutate(farmFieldsKey(farm.id))
      navigate('/')
    } catch {
      onError('Kunne ikke slette bedriften.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Slet {farm.name}?</DialogTitle>
          <DialogDescription>
            Dette sletter bedriften og alle marker, der er importeret til den.
            Handlingen kan ikke fortrydes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annuller</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={() => void confirmDelete()}
            disabled={isDeleting}
          >
            {isDeleting ? 'Sletter...' : 'Slet bedrift'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
