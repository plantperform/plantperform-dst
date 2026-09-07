import {
  ChevronRight,
  MoreHorizontal,
  Share2,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { farmFieldsKey, farmMembersKey, useFarmMembers } from '@/api/hooks'
import { addFarmMember, deleteFarm, removeFarmMember } from '@/api/mutations'
import type { Farm } from '@/api/types'
import { useAuth } from '@/auth/context'
import { UserMenu } from '@/components/UserMenu'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

type FarmTopBarProps = {
  farm: Farm
  viewLabel: string
  viewIcon: LucideIcon
  actions?: ReactNode
  onError: (message: string | null) => void
}

export const FarmTopBar = ({
  farm,
  viewLabel,
  viewIcon: ViewIcon,
  actions,
  onError,
}: FarmTopBarProps) => {
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <header className="flex min-h-13 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-1 @container">
      <SidebarTrigger
        className="size-8 shrink-0 md:hidden"
        aria-label="Vis eller skjul sidepanelet"
      />
      <Separator orientation="vertical" className="h-5 md:hidden" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate font-display text-lg tracking-tight">
          {farm.name}
        </h1>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground/60"
          aria-hidden="true"
        />
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          <ViewIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{viewLabel}</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actions}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              aria-label="Handlinger for bedriften"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem onSelect={() => setShareOpen(true)}>
              <Share2 className="mr-2 size-4" aria-hidden="true" />
              Del bedrift
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 size-4" aria-hidden="true" />
              Slet bedrift
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <UserMenu className="h-8 py-0" />
      </div>

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
