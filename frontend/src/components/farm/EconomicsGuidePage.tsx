import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  Navigate,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
  type Blocker,
} from 'react-router-dom'

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
  GuideFertiliserStep,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  FERTILISER_NOTE,
  formatDbDkk,
  NO_OVERRIDES,
  profileChanges,
  profileDbEffect,
  sameOverrides,
  withoutProfileChange,
  type EconomicsAssumptions,
  type EconomicsOverrides,
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
    label: 'Gødning',
    intro:
      'Skriv bedriftens priser på handelsgødning og husdyrgødning, hvis de afviger fra standarden.',
  },
  {
    id: 3,
    label: 'Udbytte',
    intro:
      'Sæt procenten pr. afgrøde, hvis bedriften høster mere eller mindre end normen.',
  },
  {
    id: 4,
    label: 'Markarbejde',
    intro: 'Skriv priserne fra maskinstationen eller egne maskiner.',
  },
  {
    id: 5,
    label: 'Gennemgang',
    intro:
      'Giv profilen et navn, gå ændringerne igennem og vælg, hvor den skal bruges.',
  },
] as const

const LAST_STEP = STEPS.length

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

type LeaveGuideDialogProps = {
  blocker: Blocker
  profileName: string
}

const LeaveGuideDialog = ({ blocker, profileName }: LeaveGuideDialogProps) => (
  <Dialog
    open={blocker.state === 'blocked'}
    onOpenChange={(open) => {
      if (!open) blocker.reset?.()
    }}
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Forlad guiden uden at gemme?</DialogTitle>
        <DialogDescription>
          Ændringerne i{' '}
          <b className="font-semibold text-foreground">{profileName}</b> gemmes
          først, når du klikker Færdig under Gennemgang. Forlader du siden nu,
          går de tabt.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => blocker.proceed?.()}>
          Forlad uden at gemme
        </Button>
        <Button autoFocus onClick={() => blocker.reset?.()}>
          Bliv på siden
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

type EconomicsGuidePageProps = {
  farmName: string
  simulations: Simulation[]
  onOpenSimulation: (simulationId: string) => void
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
  const [overrides, setOverrides] = useState(profile.overrides)
  const [toggledUses, setToggledUses] = useState<string[]>([])
  const saved = useRef(false)

  const changes = profileChanges(assumptions, overrides)
  const changedSteps = new Set<number | null>(
    changes.map((entry) => entry.guideStep),
  )
  const users = economics.simulationsUsingProfile(simulations, profile.id)
  const sharedNote = sharedProfileNote(users.length)
  const nameError = economics.nameError(name, profile.id)
  const sheetCrop = assumptions.crops.find(
    (crop) => crop.cropCode === sheet.cropCode,
  )
  const current = STEPS[step - 1]
  const useOptions: GuideUseOption[] = simulations.map((simulation) => ({
    id: simulation.id,
    label: simulation.name,
    note: `Regner med ${economics.profileForSimulation(simulation.id).name}`,
    checked:
      (simulation === originSimulation || users.includes(simulation)) !==
      toggledUses.includes(simulation.id),
  }))
  const dirty =
    name.trim() !== profile.name ||
    !sameOverrides(overrides, profile.overrides) ||
    toggledUses.length > 0

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !saved.current &&
      currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const toggleUse = (simulationId: string) =>
    setToggledUses((toggled) =>
      toggled.includes(simulationId)
        ? toggled.filter((entry) => entry !== simulationId)
        : [...toggled, simulationId],
    )

  const close = () => {
    if (originSimulation) onOpenSimulation(originSimulation.id)
    else navigate(origin?.returnTo ?? economics.profilePath(profile.id))
  }

  const finish = () => {
    if (nameError) return
    saved.current = true
    economics.ensureProfile(profile.id, name)
    economics.renameProfile(profile.id, name)
    economics.changeOverrides(profile.id, () => overrides)
    for (const option of useOptions) {
      const uses = users.some((simulation) => simulation.id === option.id)
      if (option.checked !== uses) {
        economics.assignProfile(
          option.id,
          option.checked ? profile.id : STANDARD_PROFILE_ID,
        )
      }
    }
    setToggledUses([])
    const chosen = useOptions.filter((option) => option.checked)
    const opened =
      chosen.find((option) => option.id === originSimulation?.id) ??
      (chosen.length === 1 ? chosen[0] : undefined)
    if (opened) onOpenSimulation(opened.id)
    else navigate(economics.profilePath(profile.id))
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
              bagefter på profilens side. Profilen gemmes først, når du klikker
              Færdig på sidste trin.
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
                overrides={overrides}
                onChange={setOverrides}
                onOpenCrop={(cropCode) => setSheet({ cropCode, open: true })}
              />
            ) : null}
            {step === 2 ? (
              <GuideFertiliserStep
                assumptions={assumptions}
                overrides={overrides}
                onChange={setOverrides}
              />
            ) : null}
            {step === 3 ? (
              <GuideYieldStep
                assumptions={assumptions}
                overrides={overrides}
                onChange={setOverrides}
              />
            ) : null}
            {step === 4 ? (
              <GuideMachinesStep
                assumptions={assumptions}
                overrides={overrides}
                onChange={setOverrides}
              />
            ) : null}
            {step === LAST_STEP ? (
              <GuideReviewStep
                name={name}
                nameError={nameError}
                changes={changes}
                useOptions={useOptions}
                onNameChange={setName}
                onRestore={(entry) =>
                  setOverrides((draft) => withoutProfileChange(draft, entry))
                }
                onRestoreAll={() => setOverrides(NO_OVERRIDES)}
                onToggleUse={toggleUse}
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
            <GuideEffect assumptions={assumptions} overrides={overrides} />
            <section className={cn(RULES_CARD_CLASS, 'px-4 py-3.5')}>
              <h2 className="text-[13px] font-semibold">
                Hvad er dækningsbidraget?
              </h2>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                Det, marken tjener pr. ha: udbytte gange salgspris plus tilskud,
                minus gødning, udsæd, planteværn, markarbejde og tørring.{' '}
                {FERTILISER_NOTE}
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
                Tallene i felterne kan rettes. De gemmes sammen med resten, når
                du klikker Færdig.
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
                  overrides={overrides}
                  crop={sheetCrop}
                  onOverridesChange={setOverrides}
                />
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
      <LeaveGuideDialog
        blocker={blocker}
        profileName={name.trim() || profile.name}
      />
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
