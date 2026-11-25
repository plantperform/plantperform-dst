import { Eye, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { ApiError } from '@/api/client'
import {
  addEconomicsModuleMember,
  useEconomicsModulesMembers,
} from '@/api/economics'
import { farmMembersPath, farmsKey, useFarmMembers } from '@/api/hooks'
import { addMember, changeMemberRole, removeMember } from '@/api/members'
import type { Farm, FieldRecord, Simulation } from '@/api/types'
import { useAuth } from '@/auth/context'
import { ConfirmDialog } from '@/components/farm/ConfirmDialog'
import { DeleteFarmDialog } from '@/components/farm/DeleteFarmDialog'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { useFarmReadOnly } from '@/components/farm/farm-access-context'
import { useMemberAccess } from '@/components/farm/member-access-state'
import {
  MemberList,
  RoleIcon,
  ShareByEmailForm,
} from '@/components/farm/MemberAccess'
import { NameList } from '@/components/NameList'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatNameList } from '@/lib/economics'
import { totalFieldAreaHa } from '@/lib/crop-area-limits'
import { profilesInUse } from '@/lib/economics-profiles'
import {
  describeLeaveFarm,
  describeShareFarm,
  MEMBERSHIP_ROLE_LABELS,
  MEMBERSHIP_ROLE_TINTS,
  memberProfileNames,
  memberProfilesLabel,
  otherMemberEmails,
} from '@/lib/farm-access'
import { formatCvr } from '@/lib/farm-form'
import { formatHectares, formatWholeNumber } from '@/lib/field-domain'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

const CARD_TITLE_CLASS = 'text-[15px] font-semibold'

const ROLE_GUIDE = [
  {
    role: 'editor',
    text: 'Kan ændre marker og simuleringer og dele bedriften.',
  },
  {
    role: 'viewer',
    text: 'Kan se bedriften og lave en kopi, men ikke ændre noget.',
  },
] as const

type FarmAboutPageProps = {
  farm: Farm
  fields?: FieldRecord[]
  simulations: Simulation[]
}

export const FarmAboutPage = ({
  farm,
  fields,
  simulations,
}: FarmAboutPageProps) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { showToast, showError } = useToast()
  const economics = useEconomicsProfiles()
  const readOnly = useFarmReadOnly()
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
    removeMember: (email) => removeMember(farmMembersPath(farm.id), email),
    changeRole: (email, role) =>
      changeMemberRole(farmMembersPath(farm.id), email, role),
    onRemoved: async (email) => {
      await mutate(farmMembersPath(farm.id))
      showToast(`${email} har ikke længere adgang`)
    },
    onRoleChanged: () => mutate(farmMembersPath(farm.id)),
    onLeft: async () => {
      await mutate(farmsKey)
      showToast(`Du har forladt ${farm.name}`)
      navigate('/', { state: HOME_OVERVIEW_STATE })
    },
    leaveFailure: 'Kunne ikke forlade bedriften.',
  })
  const details = [
    { label: 'Ejer', value: farm.ownerName },
    {
      label: 'CVR-nummer',
      value: farm.cvr ? formatCvr(farm.cvr) : 'Intet CVR',
    },
    {
      label: 'Marker',
      value: fields ? formatWholeNumber(fields.length) : '-',
    },
    {
      label: 'Areal',
      value: fields ? `${formatHectares(totalFieldAreaHa(fields))} ha` : '-',
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
          addEconomicsModuleMember(profile.id, email, access.form.role).then(
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
        await addMember(farmMembersPath(farm.id), email, access.form.role)
        const profiles = await shareProfiles(email, ids)
        await Promise.all([
          mutate(farmMembersPath(farm.id)),
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
      <div className="mx-auto max-w-[820px] px-6 pt-9 pb-15 sm:px-10">
        <h1 className="font-display text-4xl tracking-tight break-words">
          {farm.name}
        </h1>

        <dl
          aria-label="Oplysninger"
          className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border bg-card shadow-sm sm:grid-cols-4"
        >
          {details.map(({ label, value }) => (
            <div
              key={label}
              className="min-w-0 border-border/60 px-5 py-4 nth-[n+2]:border-l max-sm:nth-3:border-l-0 max-sm:nth-[n+3]:border-t"
            >
              <dt className="text-[13px] text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-[15px] font-medium break-words tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <Card
          className="mt-6 overflow-hidden"
          role="region"
          aria-labelledby="about-access"
        >
          <h2
            id="about-access"
            className={cn(CARD_TITLE_CLASS, 'border-b px-6 py-4')}
          >
            Har adgang
          </h2>
          <MemberList
            {...access.list}
            ownCard
            loading={membersLoading}
            loadError={membersError}
            retrying={membersValidating}
            onRetry={() => void retryMembers()}
            describeMember={describeMember}
          />
        </Card>

        <Card
          className="mt-4 overflow-hidden"
          role="region"
          aria-labelledby="about-roles"
        >
          <h2
            id="about-roles"
            className={cn(CARD_TITLE_CLASS, 'px-6 pt-5 pb-4')}
          >
            {access.list.canManage ? 'Del bedriften' : 'Roller'}
          </h2>
          <ul className="grid gap-3 px-6 pb-5 sm:grid-cols-2">
            {ROLE_GUIDE.map(({ role, text }) => (
              <li
                key={role}
                className="flex items-start gap-3 rounded-lg border bg-background/60 p-3.5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    MEMBERSHIP_ROLE_TINTS[role],
                  )}
                >
                  <RoleIcon role={role} className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    {MEMBERSHIP_ROLE_LABELS[role]}
                  </p>
                  <p className="text-[13px] leading-snug text-muted-foreground">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {access.list.canManage ? (
            <ShareByEmailForm
              {...access.form}
              className="border-t bg-background/50"
              onSubmit={confirmShare}
            />
          ) : readOnly ? (
            <p className="flex items-start gap-2.5 border-t bg-background/50 px-6 py-4 text-[13px] leading-normal text-muted-foreground">
              <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Du er læser. Spørg en redaktør, hvis du skal kunne ændre eller
              dele bedriften.
            </p>
          ) : null}
        </Card>

        {readOnly ? null : (
          <section
            className="mt-12 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t pt-6"
            aria-labelledby="about-delete"
          >
            <div>
              <h2 id="about-delete" className="text-sm font-semibold">
                Slet bedrift
              </h2>
              <p className="mt-1 max-w-[440px] text-[13px] leading-normal text-muted-foreground">
                Bedriften, alle dens marker og alle simuleringer slettes for
                alle, der har adgang.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Slet bedrift
            </Button>
          </section>
        )}
      </div>

      <ConfirmDialog
        name={confirmEmail}
        title={`Del ${farm.name} med ${confirmEmail}?`}
        description={describeShareFarm(confirmEmail ?? '', access.form.role)}
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
              {access.form.role === 'editor'
                ? 'Den, du deler med, kan også rette, dele og slette de profiler, du vælger.'
                : 'Den, du deler med, kan også se og bruge de profiler, du vælger, på sine egne bedrifter.'}
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
