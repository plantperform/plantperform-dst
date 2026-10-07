import {
  ArrowLeft,
  Copy,
  Pencil,
  TextCursorInput,
  Trash2,
  X,
} from 'lucide-react'
import { Fragment, useId, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { z } from 'zod'

import type { Simulation } from '@/api/types'
import {
  returnTargetLabel,
  returnTargetSchema,
  useEconomicsNavigation,
  type ReturnTarget,
} from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { EconomicsAssumptionsEditor } from '@/components/farm/EconomicsAssumptionsEditor'
import { EconomicsProfileChanges } from '@/components/farm/EconomicsProfileChanges'
import { RULES_CARD_CLASS } from '@/components/farm/rules-ui'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import {
  NO_OVERRIDES,
  profileChanges,
  profileChangesTitle,
  withoutProfileChange,
} from '@/lib/economics'
import {
  sharedProfileNote,
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

const focusSchema = z.object({ cropCode: z.number(), lineId: z.string() })

const returnStateSchema = z.object({ returnTo: returnTargetSchema })

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

type ProfileViewProps = {
  profile: EconomicsProfile
  simulations: Simulation[]
  onOpenSimulation: (simulationId: string) => void
  onDeleteProfile: (profile: EconomicsProfile) => void
  onReturn: (target: ReturnTarget) => void
}

const ProfileView = ({
  profile,
  simulations,
  onOpenSimulation,
  onDeleteProfile,
  onReturn,
}: ProfileViewProps) => {
  const location = useLocation()
  const economics = useEconomicsProfiles()
  const { startGuide } = useEconomicsNavigation()
  const isStandard = profile.id === STANDARD_PROFILE_ID
  const [editingName, setEditingName] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [dismissedReturn, setDismissedReturn] = useState<string | null>(null)
  const returnState = returnStateSchema.safeParse(location.state)
  const returnTo =
    returnState.success && dismissedReturn !== location.key
      ? returnState.data.returnTo
      : null

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
      {returnTo ? (
        <div className="sticky top-0 z-10 flex items-center gap-2.5 bg-foreground px-6 py-2 text-[13px] text-background sm:px-10">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-background focus-visible:outline-none"
            onClick={() => onReturn(returnTo)}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {returnTargetLabel(returnTo)}
          </button>
          <button
            type="button"
            aria-label="Skjul linjen"
            className="ml-auto rounded-sm text-background/70 transition-colors hover:text-background focus-visible:ring-2 focus-visible:ring-background focus-visible:outline-none"
            onClick={() => setDismissedReturn(location.key)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-8 pb-16 sm:px-10">
        <Link
          to={economics.overviewPath}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Økonomi
        </Link>
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
                ? 'Priser og mængder fra SEGES Budgetkalkuler 2026. Standarden kan ikke rettes. Tilpas økonomien laver bedriftens egen profil oven på den.'
                : 'Bedriftens priser og mængder oven på SEGES Budgetkalkuler 2026. Tallene i felterne kan altid rettes, og ændringerne gemmes med det samme.'}
              {copiedFrom ? ` Kopi af ${copiedFrom.name}.` : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => startGuide({ fromProfileId: profile.id })}>
              <Pencil aria-hidden="true" />
              {isStandard
                ? 'Tilpas økonomien til bedriften'
                : 'Tilpas i guiden'}
            </Button>
            {isStandard ? null : (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    startGuide({ fromProfileId: profile.id, copy: true })
                  }
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
              'Ingen simuleringer bruger profilen endnu. Den vælges øverst i en simulering eller i Ny simulering.'
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
          <EconomicsProfileChanges
            className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
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
