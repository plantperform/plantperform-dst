import { UserPlus } from 'lucide-react'
import type { ComponentProps, FormEvent } from 'react'

import { ApiError } from '@/api/client'
import {
  addEconomicsModuleMember,
  removeEconomicsModuleMember,
  useEconomicsModuleMembers,
} from '@/api/economics'
import { useAuth } from '@/auth/context'
import { ConfirmDialog } from '@/components/farm/ConfirmDialog'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
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
import type { EconomicsProfile } from '@/lib/economics-profiles'
import { describeLeaveProfile, otherMemberEmails } from '@/lib/farm-access'

const ProfileMembers = ({ profile }: { profile: EconomicsProfile }) => {
  const { user } = useAuth()
  const { showToast } = useToast()
  const economics = useEconomicsProfiles()
  const {
    data: members = [],
    error: membersError,
    isLoading,
    isValidating,
    mutate,
  } = useEconomicsModuleMembers(profile.id)
  const ownEmail = user?.email ?? ''
  const access = useMemberAccess({
    name: profile.name,
    members,
    ownEmail,
    removeMember: (email) => removeEconomicsModuleMember(profile.id, email),
    onRemoved: async (email) => {
      await mutate()
      showToast(`${email} har ikke længere adgang til ${profile.name}`)
    },
    onLeft: async () => {
      showToast(`Du har forladt ${profile.name}`)
      await economics.forgetProfile(profile.id)
    },
    leaveFailure: 'Kunne ikke forlade profilen.',
  })

  const share = (event: FormEvent) => {
    event.preventDefault()
    const email = access.validEmail()
    if (!email) return
    void access.share(
      async () => {
        await addEconomicsModuleMember(profile.id, email)
        await mutate()
        showToast(`${profile.name} er delt med ${email}`)
      },
      (error) =>
        error instanceof ApiError && error.status === 409
          ? 'Har allerede adgang.'
          : 'Kunne ikke dele profilen. Personen skal have en bekræftet konto i PlantPerform.',
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
        description={describeLeaveProfile(otherMemberEmails(members, ownEmail))}
        confirmLabel="Forlad profil"
      />
    </div>
  )
}

type EconomicsProfileShareButtonProps = {
  profile: EconomicsProfile
  size?: ComponentProps<typeof Button>['size']
}

export const EconomicsProfileShareButton = ({
  profile,
  size,
}: EconomicsProfileShareButtonProps) => (
  <Dialog>
    <DialogTrigger asChild>
      <Button variant="outline" size={size} aria-label={`Del ${profile.name}`}>
        <UserPlus aria-hidden="true" />
        Del
      </Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Del {profile.name}</DialogTitle>
        <DialogDescription>
          Alle, profilen er delt med, kan bruge den på deres egne bedrifter og
          rette, dele og slette den.
        </DialogDescription>
      </DialogHeader>
      <ProfileMembers profile={profile} />
    </DialogContent>
  </Dialog>
)
