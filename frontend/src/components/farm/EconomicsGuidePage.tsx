import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import type { Simulation } from '@/api/types'
import {
  CHOICE_TAB_ACTIVE_CLASS,
  CHOICE_TAB_CLASS,
  CHOICE_TAB_IDLE_CLASS,
} from '@/components/farm/choice-styles'
import {
  guideOriginSchema,
  type GuideOrigin,
} from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { CustomisedDot, DbDelta } from '@/components/farm/economics-ui'
import { EconomicsCropDetail } from '@/components/farm/EconomicsCropDetail'
import {
  GuideMachinesStep,
  GuidePricesStep,
  GuideReviewStep,
  GuideYieldStep,
  type GuideUseOption,
} from '@/components/farm/EconomicsGuideSteps'
import { RULES_CARD_CLASS } from '@/components/farm/rules-ui'
import { TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  formatDbDkk,
  NO_OVERRIDES,
  profileChanges,
  profileDbEffect,
  withoutProfileChange,
  type EconomicsAssumptions,
  type EconomicsOverrides,
  type OverridesChange,
} from '@/lib/economics'
import { STANDARD_SOURCE } from '@/lib/economics-example'
import {
  sharedProfileNote,
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { ROTATION_START_CALENDAR_YEAR } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    id: 1,
    label: 'Salgspriser',
    intro:
      'Skriv bedriftens salgspris pr. afgrøde, hvis den afviger fra standarden.',
  },
  {
    id: 2,
    label: 'Udbytte',
    intro:
      'Sæt procenten pr. afgrøde, hvis bedriften høster mere eller mindre end normen.',
  },
  {
    id: 3,
    label: 'Markarbejde',
    intro: 'Skriv priserne fra maskinstationen eller egne maskiner.',
  },
  {
    id: 4,
    label: 'Gennemgang',
    intro:
      'Giv profilen et navn, gå ændringerne igennem og vælg, hvor den skal bruges.',
  },
] as const

const LAST_STEP = STEPS.length

const USE_NEW_SIMULATION = 'new'

const USE_PROFILE_ONLY = 'none'

const EFFECT_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] items-center gap-x-2 px-4'

type GuideEffectProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
}

const GuideEffect = ({ assumptions, overrides }: GuideEffectProps) => (
  <section className={cn(RULES_CARD_CLASS, 'overflow-hidden')}>
    <h2 className="px-4 pt-3.5 text-[13px] font-semibold">
      Sådan påvirker det dækningsbidraget
    </h2>
    <div
      className={cn(
        EFFECT_GRID_CLASS,
        'pt-1 pb-2 text-xs text-muted-foreground',
      )}
    >
      <span>kr/ha</span>
      <span className="text-right">Standard</span>
      <span className="text-right">Profil</span>
      <span className="text-right">Forskel</span>
    </div>
    <ul>
      {profileDbEffect(assumptions, overrides).map((effect) => (
        <li
          key={effect.cropCode}
          className={cn(
            EFFECT_GRID_CLASS,
            'border-t py-2 text-[13px] tabular-nums',
          )}
        >
          <TruncatedTooltip content={effect.cropName} className="truncate">
            {effect.cropName}
          </TruncatedTooltip>
          <span className="text-right text-muted-foreground">
            {formatDbDkk(effect.dbDkkHa - effect.deltaDkkHa)}
          </span>
          <span
            className={cn(
              'text-right',
              effect.deltaDkkHa !== 0 && 'font-semibold',
            )}
          >
            {formatDbDkk(effect.dbDkkHa)}
          </span>
          <span className="text-right">
            <DbDelta change={effect.deltaDkkHa} />
          </span>
        </li>
      ))}
    </ul>
  </section>
)

type EconomicsGuidePageProps = {
  farmName: string
  simulations: Simulation[]
  onOpenSimulation: (simulationId: string) => void
  onNewSimulation: (profileId: string) => void
}

type GuideProps = EconomicsGuidePageProps & {
  profile: EconomicsProfile
  origin: GuideOrigin | null
}

const Guide = ({
  profile,
  origin,
  farmName,
  simulations,
  onOpenSimulation,
  onNewSimulation,
}: GuideProps) => {
  const titleId = useId()
  const navigate = useNavigate()
  const economics = useEconomicsProfiles()
  const { assumptions } = economics
  const originSimulation = simulations.find(
    (simulation) => simulation.id === origin?.simulationId,
  )
  const [step, setStep] = useState(1)
  const [sheet, setSheet] = useState({ cropCode: 0, open: false })
  const [name, setName] = useState(profile.name)
  const [chosenUse, setChosenUse] = useState(
    originSimulation?.id ?? USE_PROFILE_ONLY,
  )

  const changes = profileChanges(assumptions, profile.overrides)
  const changedSteps = new Set<number | null>(
    changes.map((entry) => entry.guideStep),
  )
  const sharedNote = sharedProfileNote(
    economics.simulationsUsingProfile(simulations, profile.id).length,
  )
  const nameError = economics.nameError(name, profile.id)
  const change = (update: OverridesChange) => {
    economics.ensureProfile(profile.id, profile.name)
    economics.changeOverrides(profile.id, update)
  }
  const sheetCrop = assumptions.crops.find(
    (crop) => crop.cropCode === sheet.cropCode,
  )
  const current = STEPS[step - 1]
  const useOptions: GuideUseOption[] = [
    ...simulations.map((simulation) => ({
      id: simulation.id,
      label: simulation.name,
      note: `Regner med ${economics.profileForSimulation(simulation.id).name}`,
    })),
    {
      id: USE_NEW_SIMULATION,
      label: 'En ny simulering',
      note: 'Ny simulering åbner med profilen valgt',
    },
    {
      id: USE_PROFILE_ONLY,
      label: 'Gem kun profilen',
      note: 'Den kan vælges i en simulering senere',
    },
  ]
  const useChoice = useOptions.some((option) => option.id === chosenUse)
    ? chosenUse
    : USE_PROFILE_ONLY

  const close = () => {
    if (originSimulation) onOpenSimulation(originSimulation.id)
    else navigate(origin?.returnTo ?? economics.profilePath(profile.id))
  }

  const finish = () => {
    if (nameError) return
    economics.ensureProfile(profile.id, name)
    economics.renameProfile(profile.id, name)
    if (useChoice === USE_NEW_SIMULATION) {
      onNewSimulation(profile.id)
    } else if (useChoice === USE_PROFILE_ONLY) {
      navigate(economics.profilePath(profile.id))
    } else {
      economics.assignProfile(useChoice, profile.id)
      onOpenSimulation(useChoice)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container mx-auto flex max-w-6xl flex-col gap-5 px-6 pt-10 pb-16 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-4xl tracking-tight break-words">
              Tilpas økonomien til {farmName}
            </h1>
            <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
              Standarden er {STANDARD_SOURCE}. Her retter du de få tal, der
              plejer at betyde mest for dækningsbidraget. Alt andet kan rettes
              bagefter på profilens side. Ændringerne gemmes med det samme i{' '}
              <b className="font-semibold text-foreground">{profile.name}</b>.
              {sharedNote ? ` ${sharedNote}` : null}
            </p>
          </div>
          <Button variant="outline" onClick={close}>
            Luk
          </Button>
        </header>

        <ol className="flex flex-wrap gap-2">
          {STEPS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-current={entry.id === step ? 'step' : undefined}
                className={cn(
                  CHOICE_TAB_CLASS,
                  'px-3 py-1.5 text-sm',
                  entry.id === step
                    ? CHOICE_TAB_ACTIVE_CLASS
                    : CHOICE_TAB_IDLE_CLASS,
                )}
                onClick={() => setStep(entry.id)}
              >
                {entry.id}. {entry.label}
                {changedSteps.has(entry.id) ? <CustomisedDot /> : null}
              </button>
            </li>
          ))}
        </ol>

        <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1fr)_20rem] @5xl:items-start">
          <section
            aria-labelledby={titleId}
            className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
          >
            <div className="px-5 pt-4 pb-3.5">
              <h2 id={titleId} className="text-[17px] font-semibold">
                {current.label}
              </h2>
              <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
                {current.intro}
              </p>
            </div>
            {step === 1 ? (
              <GuidePricesStep
                assumptions={assumptions}
                overrides={profile.overrides}
                onChange={change}
                onOpenCrop={(cropCode) => setSheet({ cropCode, open: true })}
              />
            ) : null}
            {step === 2 ? (
              <GuideYieldStep
                assumptions={assumptions}
                overrides={profile.overrides}
                onChange={change}
              />
            ) : null}
            {step === 3 ? (
              <GuideMachinesStep
                assumptions={assumptions}
                overrides={profile.overrides}
                onChange={change}
              />
            ) : null}
            {step === LAST_STEP ? (
              <GuideReviewStep
                name={name}
                nameError={nameError}
                changes={changes}
                useOptions={useOptions}
                useChoice={useChoice}
                onNameChange={setName}
                onRestore={(entry) =>
                  change((overrides) => withoutProfileChange(overrides, entry))
                }
                onRestoreAll={() => change(() => NO_OVERRIDES)}
                onUseChoiceChange={setChosenUse}
              />
            ) : null}
            <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
              {step > 1 ? (
                <Button variant="outline" onClick={() => setStep(step - 1)}>
                  <ArrowLeft aria-hidden="true" />
                  Tilbage
                </Button>
              ) : (
                <span />
              )}
              {step < LAST_STEP ? (
                <Button onClick={() => setStep(step + 1)}>
                  Næste
                  <ArrowRight aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  onClick={(event) => {
                    if (event.detail < 2) finish()
                  }}
                >
                  <Check aria-hidden="true" />
                  Færdig
                </Button>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <GuideEffect
              assumptions={assumptions}
              overrides={profile.overrides}
            />
            <section className={cn(RULES_CARD_CLASS, 'px-4 py-3.5')}>
              <h2 className="text-[13px] font-semibold">
                Hvad er dækningsbidraget?
              </h2>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                Det, marken tjener pr. ha: udbytte gange salgspris plus tilskud,
                minus udsæd, planteværn, markarbejde og tørring. Gødning regnes
                ud fra kvælstofnormen i hver simulering og er ikke med her.
              </p>
            </section>
          </aside>
        </div>
      </div>

      <Sheet
        open={sheet.open}
        onOpenChange={(open) => setSheet({ ...sheet, open })}
      >
        <SheetContent
          showCloseButton={false}
          className="w-full gap-0 sm:max-w-3xl"
          onEscapeKeyDown={(event) => {
            if (event.target instanceof HTMLInputElement) event.preventDefault()
          }}
        >
          <div className="flex items-start gap-3.5 border-b bg-card px-6 py-4">
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-display text-[22px] font-normal">
                Alle poster
              </SheetTitle>
              <SheetDescription className="text-[13px]">
                Tallene i felterne kan rettes og gemmes i {profile.name}.
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Luk"
              >
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {sheetCrop ? (
              <div className={cn(RULES_CARD_CLASS, 'overflow-hidden')}>
                <EconomicsCropDetail
                  key={sheetCrop.cropCode}
                  assumptions={assumptions}
                  overrides={profile.overrides}
                  crop={sheetCrop}
                  onOverridesChange={change}
                />
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

export const EconomicsGuidePage = (props: EconomicsGuidePageProps) => {
  const { profileId } = useParams()
  const { state } = useLocation()
  const economics = useEconomicsProfiles()
  const origin = guideOriginSchema.safeParse(state)
  const profile =
    (profileId ? economics.findProfile(profileId) : undefined) ??
    (profileId && origin.success
      ? {
          id: profileId,
          name: economics.newProfileName(
            `${props.farmName} ${ROTATION_START_CALENDAR_YEAR}`,
          ),
          overrides: NO_OVERRIDES,
        }
      : undefined)

  if (!profile || profile.id === STANDARD_PROFILE_ID) {
    return <Navigate to={economics.overviewPath} replace />
  }

  return (
    <Guide
      key={profile.id}
      profile={profile}
      origin={origin.success ? origin.data.guide : null}
      {...props}
    />
  )
}
