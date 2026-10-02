import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Fragment, useId, useRef, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { z } from 'zod'

import type { Simulation } from '@/api/types'
import { EconomicsAssumptionsEditor } from '@/components/farm/EconomicsAssumptionsEditor'
import {
  profilePageRequestSchema,
  useEconomicsProfiles,
  useProfilePageNavigation,
} from '@/components/farm/economics-profiles-state'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import {
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'

const focusSchema = z.object({ cropCode: z.number(), lineId: z.string() })

const simulationList = new Intl.ListFormat('da-DK', {
  style: 'long',
  type: 'conjunction',
})

type ProfileNameInputProps = {
  profile: EconomicsProfile
  onDone: () => void
}

const ProfileNameInput = ({ profile, onDone }: ProfileNameInputProps) => {
  const economics = useEconomicsProfiles()
  const id = useId()
  const [name, setName] = useState(profile.name)
  const cancelled = useRef(false)
  const error = economics.nameError(name, profile.id)

  const save = () => {
    if (cancelled.current || error) return
    economics.renameProfile(profile.id, name)
    onDone()
  }

  return (
    <form
      className="max-w-xl space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <Input
        autoFocus
        autoComplete="off"
        aria-label="Profilens navn"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-auto px-2 py-0 font-display text-4xl tracking-tight"
        value={name}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          cancelled.current = true
          onDone()
        }}
      />
      <FieldError id={`${id}-error`} message={error} />
    </form>
  )
}

type ProfileViewProps = {
  profile: EconomicsProfile
  simulations: Simulation[]
  onOpenSimulation: (simulationId: string) => void
  onDeleteProfile: (profile: EconomicsProfile) => void
}

const ProfileView = ({
  profile,
  simulations,
  onOpenSimulation,
  onDeleteProfile,
}: ProfileViewProps) => {
  const location = useLocation()
  const economics = useEconomicsProfiles()
  const { openNewProfile } = useProfilePageNavigation()
  const isStandard = profile.id === STANDARD_PROFILE_ID
  const request = profilePageRequestSchema.safeParse(location.state)
  const nameRequestKey = request.success && !isStandard ? location.key : null
  const [editingName, setEditingName] = useState(false)
  const [shownRequest, setShownRequest] = useState<string | null>(null)

  if (nameRequestKey !== null && nameRequestKey !== shownRequest) {
    setShownRequest(nameRequestKey)
    setEditingName(true)
  }

  const users = economics.simulationsUsingProfile(simulations, profile.id)
  const userNames = new Map(
    users.map((simulation) => [simulation.id, simulation.name]),
  )
  const focus = focusSchema.safeParse(location.state)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-10 pb-16 sm:px-10">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            {editingName ? (
              <ProfileNameInput
                profile={profile}
                onDone={() => setEditingName(false)}
              />
            ) : (
              <h1 className="font-display text-4xl tracking-tight break-words">
                {profile.name}
              </h1>
            )}
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              {isStandard
                ? 'Priser og mængder fra SEGES Budgetkalkuler 2026. Standarden kan ikke rettes, så lav en ny økonomiprofil, hvis tallene skal passe til bedriften.'
                : 'Priser og mængder bag dækningsbidraget. Profilen bygger på SEGES Budgetkalkuler 2026, og du retter tallene, så de passer til bedriften.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isStandard ? (
              <Button onClick={openNewProfile}>
                <Plus aria-hidden="true" />
                Ny økonomiprofil
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setEditingName(true)}>
                  <Pencil aria-hidden="true" />
                  Omdøb
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onDeleteProfile(profile)}
                >
                  <Trash2 aria-hidden="true" />
                  Slet
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="space-y-1.5 text-sm">
          <p className="text-muted-foreground">
            {users.length === 0 ? (
              'Ingen simuleringer bruger profilen endnu. Den vælges i Ny simulering eller under Regler i en simulering.'
            ) : (
              <>
                Bruges af{' '}
                {simulationList
                  .formatToParts(users.map((simulation) => simulation.id))
                  .map((part, index) =>
                    part.type === 'element' ? (
                      <button
                        key={index}
                        type="button"
                        className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onOpenSimulation(part.value)}
                      >
                        {userNames.get(part.value)}
                      </button>
                    ) : (
                      <Fragment key={index}>{part.value}</Fragment>
                    ),
                  )}
                .
              </>
            )}
          </p>
          <p className="text-amber-800">
            Eksempeldata for konventionel drift på JB 5-6. Profilerne gemmes kun
            i denne browser og indgår ikke i beregningen endnu.
          </p>
        </div>

        <EconomicsAssumptionsEditor
          assumptions={economics.assumptions}
          overrides={profile.overrides}
          onOverridesChange={
            isStandard
              ? undefined
              : (change) => economics.changeOverrides(profile.id, change)
          }
          defaultEditing={request.success && request.data.request === 'new'}
          focus={
            focus.success ? { ...focus.data, key: location.key } : undefined
          }
        />
      </div>
    </div>
  )
}

type EconomicsProfilePageProps = Omit<ProfileViewProps, 'profile'>

export const EconomicsProfilePage = (props: EconomicsProfilePageProps) => {
  const { profileId = STANDARD_PROFILE_ID } = useParams()
  const economics = useEconomicsProfiles()
  const profile = economics.findProfile(profileId)

  if (!profile) {
    return <Navigate to={economics.profilePath(STANDARD_PROFILE_ID)} replace />
  }

  return <ProfileView key={profile.id} profile={profile} {...props} />
}
