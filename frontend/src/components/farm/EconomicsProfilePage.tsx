import { Copy, Plus, TextCursorInput, Trash2, Undo2 } from 'lucide-react'
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
import { RULES_CARD_CLASS } from '@/components/farm/rules-ui'
import { AppTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import {
  formatNameList,
  NO_OVERRIDES,
  profileChanges,
  profileChangesTitle,
  withoutProfileChange,
  type ProfileChange,
} from '@/lib/economics'
import {
  sharedProfileNote,
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

const focusSchema = z.object({ cropCode: z.number(), lineId: z.string() })

const simulationList = new Intl.ListFormat('da-DK', {
  style: 'long',
  type: 'conjunction',
})

const LINK_CLASS =
  'rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

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

type ProfileChangesProps = {
  changes: ProfileChange[]
  onRestore: (change: ProfileChange) => void
  onRestoreAll: () => void
}

const ProfileChanges = ({
  changes,
  onRestore,
  onRestoreAll,
}: ProfileChangesProps) => {
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          {profileChangesTitle(changes.length)}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={onRestoreAll}
        >
          <Undo2 aria-hidden="true" />
          Gendan alt
        </Button>
      </div>
      <ul>
        {changes.map((change) => (
          <li
            key={change.key}
            className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto_1.75rem] items-center gap-3 border-t px-5 py-2.5 text-[13px]"
          >
            <span className="text-muted-foreground">
              {formatNameList(change.cropNames)}
            </span>
            <span className="font-medium">{change.label}</span>
            <span className="text-right tabular-nums">
              <span className="text-muted-foreground">{change.from} → </span>
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold">
                {change.to}
              </span>
            </span>
            <AppTooltip content="Gendan standard">
              <button
                type="button"
                aria-label={`Gendan standard for ${change.label}`}
                className="inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => onRestore(change)}
              >
                <Undo2 className="size-3.5" aria-hidden="true" />
              </button>
            </AppTooltip>
          </li>
        ))}
      </ul>
    </section>
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
  const { openNewProfile, openProfileCopy } = useProfilePageNavigation()
  const isStandard = profile.id === STANDARD_PROFILE_ID
  const request = profilePageRequestSchema.safeParse(location.state)
  const nameRequestKey = request.success && !isStandard ? location.key : null
  const [editingName, setEditingName] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [shownRequest, setShownRequest] = useState<string | null>(null)

  if (nameRequestKey !== null && nameRequestKey !== shownRequest) {
    setShownRequest(nameRequestKey)
    setEditingName(true)
  }

  const users = economics.simulationsUsingProfile(simulations, profile.id)
  const userNames = new Map(
    users.map((simulation) => [simulation.id, simulation.name]),
  )
  const sharedNote = isStandard ? null : sharedProfileNote(users.length)
  const changes = profileChanges(economics.assumptions, profile.overrides)
  const copiedFrom = profile.copiedFromId
    ? economics.findProfile(profile.copiedFromId)
    : undefined
  const focus = focusSchema.safeParse(location.state)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-10 pb-16 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
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
                : 'Bedriftens priser og mængder oven på SEGES Budgetkalkuler 2026. Tallene i felterne kan altid rettes, og ændringerne gemmes med det samme.'}
              {copiedFrom ? ` Kopi af ${copiedFrom.name}.` : null}
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
                <Button
                  variant="outline"
                  onClick={() => openProfileCopy(profile.id)}
                >
                  <Copy aria-hidden="true" />
                  Ny udgave
                </Button>
                <Button variant="outline" onClick={() => setEditingName(true)}>
                  <TextCursorInput aria-hidden="true" />
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
                        className={LINK_CLASS}
                        onClick={() => onOpenSimulation(part.value)}
                      >
                        {userNames.get(part.value)}
                      </button>
                    ) : (
                      <Fragment key={index}>{part.value}</Fragment>
                    ),
                  )}
                .{sharedNote ? ` ${sharedNote}` : null}
              </>
            )}
          </p>
          {isStandard ? null : (
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {changes.length > 0 ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-amber-500"
                  aria-hidden="true"
                />
              ) : null}
              <span>{profileChangesTitle(changes.length)}</span>
              {changes.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={changesOpen}
                  className={LINK_CLASS}
                  onClick={() => setChangesOpen((open) => !open)}
                >
                  {changesOpen ? 'Skjul ændringer' : 'Vis ændringer'}
                </button>
              ) : null}
            </p>
          )}
          <p className="text-amber-800">
            Profilerne gemmes kun i denne browser og indgår ikke i beregningen
            endnu.
          </p>
        </div>

        {changesOpen && changes.length > 0 ? (
          <ProfileChanges
            changes={changes}
            onRestore={(change) =>
              economics.changeOverrides(profile.id, (current) =>
                withoutProfileChange(economics.assumptions, current, change),
              )
            }
            onRestoreAll={() =>
              economics.changeOverrides(profile.id, () => NO_OVERRIDES)
            }
          />
        ) : null}

        <EconomicsAssumptionsEditor
          assumptions={economics.assumptions}
          overrides={profile.overrides}
          onOverridesChange={
            isStandard
              ? undefined
              : (change) => economics.changeOverrides(profile.id, change)
          }
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
