import { Pencil, TextCursorInput, Trash2 } from 'lucide-react'
import { Fragment, useId, useRef, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { z } from 'zod'

import type { Simulation } from '@/api/types'
import { BackButton, BackLink } from '@/components/BackLink'
import {
  returnTargetLabel,
  returnTargetSchema,
  useStartGuide,
  type ReturnTarget,
} from '@/components/farm/economics-navigation'
import {
  useEconomicsAssumptions,
  useEconomicsProfiles,
} from '@/components/farm/economics-profiles-state'
import {
  BudgetsGate,
  FarmingSystemSwitch,
  TEXT_LINK_CLASS,
} from '@/components/farm/economics-ui'
import { EconomicsAssumptionsEditor } from '@/components/farm/EconomicsAssumptionsEditor'
import { EconomicsProfileChanges } from '@/components/farm/EconomicsProfileChanges'
import { RULES_CARD_CLASS } from '@/components/farm/rules-ui'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import {
  describeBudgetSoil,
  nameListFormat,
  NO_OVERRIDES,
  profileChanges,
  profileChangesTitle,
  withoutProfileChange,
  type EconomicsAssumptions,
} from '@/lib/economics'
import {
  describeProfileUsers,
  PROFILES_NOT_IN_CALCULATION,
  sharedProfileNote,
  STANDARD_PROFILE_ID,
  STANDARD_SOURCE,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

const focusSchema = z.object({ cropCode: z.number(), lineId: z.string() })

const returnStateSchema = z.object({ returnTo: returnTargetSchema })

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

type ProfileBodyProps = {
  assumptions: EconomicsAssumptions
  profile: EconomicsProfile
  simulations: Simulation[]
  onOpenSimulation: (simulationId: string) => void
}

const ProfileBody = ({
  assumptions,
  profile,
  simulations,
  onOpenSimulation,
}: ProfileBodyProps) => {
  const location = useLocation()
  const economics = useEconomicsProfiles()
  const isStandard = profile.id === STANDARD_PROFILE_ID
  const [changesOpen, setChangesOpen] = useState(false)
  const users = economics.simulationsUsingProfile(simulations, profile.id)
  const userNames = new Map(
    users.map((simulation) => [simulation.id, simulation.name]),
  )
  const sharedNote = isStandard ? null : sharedProfileNote(users.length)
  const changes = profileChanges(assumptions, profile.overrides)
  const focus = focusSchema.safeParse(location.state)

  return (
    <>
      <div className="space-y-1.5 text-sm">
        <p className="text-muted-foreground">
          {users.length === 0 ? (
            `${describeProfileUsers([])}.`
          ) : (
            <>
              Bruges af{' '}
              {nameListFormat
                .formatToParts(users.map((simulation) => simulation.id))
                .map((part, index) =>
                  part.type === 'element' ? (
                    <button
                      key={index}
                      type="button"
                      className={TEXT_LINK_CLASS}
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
            {changesOpen ? null : (
              <span>{profileChangesTitle(changes.length)}</span>
            )}
            {changes.length > 0 ? (
              <button
                type="button"
                aria-expanded={changesOpen}
                className={TEXT_LINK_CLASS}
                onClick={() => setChangesOpen((open) => !open)}
              >
                {changesOpen ? 'Skjul ændringer' : 'Vis ændringer'}
              </button>
            ) : null}
          </p>
        )}
        <p className="text-muted-foreground">
          {describeBudgetSoil(assumptions)}
        </p>
        <p className="text-warning-strong">{PROFILES_NOT_IN_CALCULATION}</p>
      </div>

      {changesOpen && changes.length > 0 ? (
        <EconomicsProfileChanges
          className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
          changes={changes}
          onRestore={(change) =>
            economics.changeOverrides(profile.id, (current) =>
              withoutProfileChange(current, change),
            )
          }
          onRestoreAll={() =>
            economics.changeOverrides(profile.id, () => NO_OVERRIDES)
          }
        />
      ) : null}

      <EconomicsAssumptionsEditor
        key={location.key}
        assumptions={assumptions}
        overrides={profile.overrides}
        onOverridesChange={
          isStandard
            ? undefined
            : (change) => economics.changeOverrides(profile.id, change)
        }
        focus={focus.success ? focus.data : undefined}
      />
    </>
  )
}

type ProfileViewProps = {
  profile: EconomicsProfile
  farmName: string
  simulations: Simulation[]
  onOpenSimulation: (simulationId: string) => void
  onDeleteProfile: (profile: EconomicsProfile) => void
  onReturn: (target: ReturnTarget) => void
}

const ProfileView = ({
  profile,
  farmName,
  simulations,
  onOpenSimulation,
  onDeleteProfile,
  onReturn,
}: ProfileViewProps) => {
  const location = useLocation()
  const economics = useEconomicsProfiles()
  const startGuide = useStartGuide()
  const isStandard = profile.id === STANDARD_PROFILE_ID
  const [editingName, setEditingName] = useState(false)
  const returnState = returnStateSchema.safeParse(location.state)
  const returnTo = returnState.success ? returnState.data.returnTo : null
  const budgets = useEconomicsAssumptions()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container flex max-w-6xl flex-col gap-6 px-6 pt-7 pb-15 sm:px-10">
        {returnTo ? (
          <BackButton onClick={() => onReturn(returnTo)}>
            {returnTargetLabel(returnTo)}
          </BackButton>
        ) : (
          <BackLink to={economics.overviewPath}>Tilbage til Økonomi</BackLink>
        )}
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
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {farmName} ·{' '}
              {isStandard
                ? `${STANDARD_SOURCE}. Standard kan ikke rettes.`
                : `Bedriftens priser, mængder og udbytter oven på ${STANDARD_SOURCE}. Rettelser gemmes med det samme.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FarmingSystemSwitch />
            <Button onClick={() => startGuide({ fromProfileId: profile.id })}>
              <Pencil aria-hidden="true" />
              {isStandard ? 'Lav en profil ud fra Standard' : 'Tilpas i guiden'}
            </Button>
            {isStandard ? null : (
              <>
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

        <BudgetsGate budgets={budgets}>
          {(assumptions) => (
            <ProfileBody
              assumptions={assumptions}
              profile={profile}
              simulations={simulations}
              onOpenSimulation={onOpenSimulation}
            />
          )}
        </BudgetsGate>
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
    return <Navigate to={economics.overviewPath} replace />
  }

  return <ProfileView key={profile.id} profile={profile} {...props} />
}
