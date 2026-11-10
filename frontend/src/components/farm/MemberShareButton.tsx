import { UserPlus } from 'lucide-react'
import type { ComponentProps, FormEvent } from 'react'

import { ApiError } from '@/api/client'
import { addMember, removeMember, useMembers } from '@/api/members'
import { useAuth } from '@/auth/context'
import { ConfirmDialog } from '@/components/farm/ConfirmDialog'
import { useMemberAccess } from '@/components/farm/member-access-state'
import { MemberList, ShareByEmailForm } from '@/components/farm/MemberAccess'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { otherMemberEmails } from '@/lib/farm-access'

type MembersProps = {
  name: string
  membersPath: string
  leaveDescription: (otherEmails: string[]) => string
  leaveLabel: string
  leaveFailure: string
  shareFailure: string
  onLeft: () => unknown
}

const Members = ({
  name,
  membersPath,
  leaveDescription,
  leaveLabel,
  leaveFailure,
  shareFailure,
  onLeft,
}: MembersProps) => {
  const { user } = useAuth()
  const { showToast } = useToast()
  const {
    data: members = [],
    error: membersError,
    isLoading,
    isValidating,
    mutate,
  } = useMembers(membersPath)
  const ownEmail = user?.email ?? ''
  const access = useMemberAccess({
    name,
    members,
    ownEmail,
    removeMember: (email) => removeMember(membersPath, email),
    onRemoved: async (email) => {
      await mutate()
      showToast(`${email} har ikke længere adgang til ${name}`)
    },
    onLeft: async () => {
      showToast(`Du har forladt ${name}`)
      await onLeft()
    },
    leaveFailure,
  })

  const share = (event: FormEvent) => {
    event.preventDefault()
    const email = access.validEmail()
    if (!email) return
    void access.share(
      async () => {
        await addMember(membersPath, email)
        await mutate()
        showToast(`${name} er delt med ${email}`)
      },
      (error) =>
        error instanceof ApiError && error.status === 409
          ? 'Har allerede adgang.'
          : shareFailure,
    )
  }

  return (
    <div className="-mx-6 border-t">
      <MemberList
        {...access.list}
        loading={isLoading}
        loadError={membersError}
        retrying={isValidating}
        onRetry={() => void mutate()}
      />
      <ShareByEmailForm {...access.form} className="pb-0" onSubmit={share} />
      <ConfirmDialog
        {...access.leave}
        description={leaveDescription(otherMemberEmails(members, ownEmail))}
        confirmLabel={leaveLabel}
      />
    </div>
  )
}

type MemberShareButtonProps = MembersProps & {
  description: string
  size?: ComponentProps<typeof Button>['size']
}

export const MemberShareButton = ({
  description,
  size,
  ...members
}: MemberShareButtonProps) => (
  <Dialog>
    <DialogTrigger asChild>
      <Button variant="outline" size={size} aria-label={`Del ${members.name}`}>
        <UserPlus aria-hidden="true" />
        Del
      </Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Del {members.name}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <Members {...members} />
    </DialogContent>
  </Dialog>
)
