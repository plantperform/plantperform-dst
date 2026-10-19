import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { ApiError } from '@/api/client'
import {
  addEconomicsModuleMember,
  useEconomicsModulesMembers,
} from '@/api/economics'
import { farmMembersKey, farmsKey, useFarmMembers } from '@/api/hooks'
import { addFarmMember, removeFarmMember } from '@/api/mutations'
import type { Farm, Simulation } from '@/api/types'
import { useAuth } from '@/auth/context'
import { ConfirmDialog } from '@/components/farm/ConfirmDialog'
import { DeleteFarmDialog } from '@/components/farm/DeleteFarmDialog'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { useMemberAccess } from '@/components/farm/member-access-state'
import { MemberList, ShareByEmailForm } from '@/components/farm/MemberAccess'
import { NameList } from '@/components/NameList'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatNameList } from '@/lib/economics'
import { profilesInUse } from '@/lib/economics-profiles'
import {
  describeLeaveFarm,
  describeShareFarm,
  memberProfileNames,
  memberProfilesLabel,
  otherMemberEmails,
} from '@/lib/farm-access'
import { formatCvr } from '@/lib/farm-form'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

const CARD_TITLE_CLASS = 'text-[15px] font-semibold'

type FarmAboutPageProps = {
  farm: Farm
  simulations: Simulation[]
}

export const FarmAboutPage = ({ farm, simulations }: FarmAboutPageProps) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { showToast, showError } = useToast()
  const economics = useEconomicsProfiles()
  const farmProfiles = profilesInUse(economics.ownProfiles ?? [], simulations)
  const { data: profileMembers, mutate: refreshProfileMembers } =
    useEconomicsModulesMembers(farmProfiles.map((profile) => profile.id))
  const sharedProfiles = farmProfiles.map((profile) => ({
    name: profile.name,
    members: profileMembers?.[profile.id] ?? [],
  }))
  const {
    data: members = [],
    error: membersError,
    isLoading: membersLoading,
    isValidating: membersValidating,
    mutate: retryMembers,
  } = useFarmMembers(farm.id)
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null)
  const [profileIds, setProfileIds] = useState<string[]>([])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const ownEmail = user?.email ?? ''
  const otherEmails = otherMemberEmails(members, ownEmail)
  const access = useMemberAccess({
    name: farm.name,
    members,
    ownEmail,
    removeMember: (email) => removeFarmMember(farm.id, email),
    onRemoved: async (email) => {
      await mutate(farmMembersKey(farm.id))
      showToast(`${email} har ikke længere adgang`)
    },
    onLeft: async () => {
      await mutate(farmsKey)
      showToast(`Du har forladt ${farm.name}`)
      navigate('/', { state: HOME_OVERVIEW_STATE })
    },
    leaveFailure: 'Kunne ikke forlade bedriften.',
  })
  const details = [
    { label: 'Bedriftens navn', value: farm.name },
    { label: 'Ejer', value: farm.ownerName },
    {
      label: 'CVR-nummer',
      value: farm.cvr ? formatCvr(farm.cvr) : 'Intet CVR',
    },
  ]

  const confirmShare = (event: FormEvent) => {
    event.preventDefault()
    const email = access.validEmail()
    if (!email) return
    setProfileIds([])
    setConfirmEmail(email)
  }

  const toggleProfile = (profileId: string) =>
    setProfileIds((current) =>
      current.includes(profileId)
        ? current.filter((id) => id !== profileId)
        : [...current, profileId],
    )

  const shareProfiles = (email: string, ids: string[]) =>
    Promise.all(
      farmProfiles
        .filter((profile) => ids.includes(profile.id))
        .map((profile) =>
          addEconomicsModuleMember(profile.id, email).then(
            () => ({ name: profile.name, shared: true }),
            (error: unknown) => ({
              name: profile.name,
              shared: error instanceof ApiError && error.status === 409,
            }),
          ),
        ),
    )

  const share = (email: string, ids: string[]) =>
    access.share(
      async () => {
        await addFarmMember(farm.id, email)
        const profiles = await shareProfiles(email, ids)
        await Promise.all([
          mutate(farmMembersKey(farm.id)),
          refreshProfileMembers(),
        ])
        const names = (shared: boolean) =>
          profiles
            .filter((profile) => profile.shared === shared)
            .map((profile) => profile.name)
        showToast(
          `${email} har nu adgang til ${formatNameList([farm.name, ...names(true)])}`,
        )
        if (names(false).length > 0) {
          showError(
            `${formatNameList(names(false))} kunne ikke deles med ${email}. Del dem fra Økonomi.`,
          )
        }
      },
      () =>
        'Kunne ikke dele bedriften. Personen skal have en bekræftet konto i PlantPerform.',
    )

  const describeMember = (email: string) => {
    const names =
      email === ownEmail ? [] : memberProfileNames(email, sharedProfiles)
    return names.length > 0 ? (
      <>
        {memberProfilesLabel(names.length)}{' '}
        <NameList
          items={names}
          renderItem={(name) => (
            <b className="font-semibold text-foreground">{name}</b>
          )}
        />
      </>
    ) : null
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="max-w-[760px] px-6 pt-9 pb-15 sm:px-10">
        <h1 className="font-display text-4xl tracking-tight break-words">
          {farm.name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Navn, ejer, CVR og hvem der har adgang.
        </p>

        <Card className="mt-6" role="region" aria-labelledby="about-info">
          <h2
            id="about-info"
            className={cn(CARD_TITLE_CLASS, 'border-b px-6 py-4')}
          >
            Oplysninger
          </h2>
          <dl className="grid gap-x-4 gap-y-5 px-6 pt-5 pb-6 sm:grid-cols-2">
            {details.map(({ label, value }) => (
              <div key={label}>
                <dt className="text-[13px] text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-[15px] break-words tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card
          className="mt-4 overflow-hidden"
          role="region"
          aria-labelledby="about-access"
        >
          <div className="border-b px-6 py-4">
            <h2 id="about-access" className={CARD_TITLE_CLASS}>
              Adgang
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Alle med adgang kan det samme: se marker, oprette simuleringer og
              dele bedriften videre.
            </p>
          </div>
          <MemberList
            {...access.list}
            loading={membersLoading}
            loadError={membersError}
            retrying={membersValidating}
            onRetry={() => void retryMembers()}
            describeMember={describeMember}
          />
          <ShareByEmailForm
            {...access.form}
            className="bg-background/50"
            onSubmit={confirmShare}
          />
        </Card>

        <Card
          className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-6 py-5"
          role="region"
          aria-labelledby="about-delete"
        >
          <div>
            <h2 id="about-delete" className={CARD_TITLE_CLASS}>
              Slet bedrift
            </h2>
            <p className="mt-1 max-w-[440px] text-[13px] leading-normal text-muted-foreground">
              Bedriften, alle dens marker og alle simuleringer slettes for alle,
              der har adgang.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Slet bedrift
          </Button>
        </Card>
      </div>

      <ConfirmDialog
        name={confirmEmail}
        title={`Del ${farm.name} med ${confirmEmail}?`}
        description={describeShareFarm(confirmEmail ?? '')}
        confirmLabel="Del bedrift"
        destructive={false}
        onOpenChange={(open) => {
          if (!open) setConfirmEmail(null)
        }}
        onConfirm={() => {
          if (confirmEmail) void share(confirmEmail, profileIds)
        }}
      >
        {farmProfiles.length > 0 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">
              Del også økonomiprofiler, bedriften bruger
            </legend>
            {farmProfiles.map((profile) => (
              <label
                key={profile.id}
                className="flex items-center gap-2.5 text-sm"
              >
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={profileIds.includes(profile.id)}
                  onChange={() => toggleProfile(profile.id)}
                />
                {profile.name}
              </label>
            ))}
            <p className="text-[13px] text-muted-foreground">
              Den, du deler med, kan også rette, dele og slette de profiler, du
              vælger.
            </p>
          </fieldset>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        {...access.leave}
        description={describeLeaveFarm(otherEmails)}
        confirmLabel="Forlad bedrift"
      />
      <DeleteFarmDialog
        farm={farm}
        sharedWith={otherEmails}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}
