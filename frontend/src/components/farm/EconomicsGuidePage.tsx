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
import {
  useEconomicsAssumptions,
  useEconomicsProfiles,
} from '@/components/farm/economics-profiles-state'
import {
  BudgetsGate,
  CustomisedDot,
  DbDelta,
  ProfilesStatus,
} from '@/components/farm/economics-ui'
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
import { LeaveFlowDialog } from '@/components/LeaveFlowDialog'
import { TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { useLeaveGuard } from '@/hooks/use-leave-guard'
import {
  applyOverrideEdits,
  FERTILISER_NOTE,
  formatCropCount,
  formatDbDkk,
  NO_OVERRIDES,
  profileChanges,
  profileDbEffect,
  sameOverrides,
  withoutProfileChange,
  withoutProfileChanges,
  type EconomicsAssumptions,
  type EconomicsOverrides,
} from '@/lib/economics'
import {
  sharedProfileNote,
  STANDARD_PROFILE_ID,
  STANDARD_SOURCE,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { ROTATION_START_CALENDAR_YEAR } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    id: 1,
    label: 'Salgspriser',
    intro: 'Skriv din salgspris pr. afgrøde, hvis den afviger fra standarden.',
  },
  {
    id: 2,
    label: 'Gødning',
    intro:
      'Skriv dine priser på handelsgødning og udbringning, hvis de afviger fra standarden.',
  },
  {
    id: 3,
    label: 'Udbytte',
    intro:
      'Sæt procenten pr. afgrøde, hvis du høster mere eller mindre end normen.',
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

const GuideEffect = ({ assumptions, overrides }: GuideEffectProps) => {
  const effects = profileDbEffect(assumptions, overrides)
  const moved = effects.filter((effect) => effect.deltaDkkHa !== 0)
  const unchanged = effects.length - moved.length
  const note =
    moved.length === 0
      ? `Samme dækningsbidrag som Standard for alle ${formatCropCount(effects.length)}.`
      : unchanged > 0
        ? `${formatCropCount(unchanged)} uden ændring.`
        : null

  return (
    <section className={cn(RULES_CARD_CLASS, 'overflow-hidden')}>
      <h2 className="px-4 pt-3.5 text-[13px] font-semibold">
        Sådan påvirker det dækningsbidraget
      </h2>
      {moved.length > 0 ? (
        <>
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
            {moved.map((effect) => (
              <li
                key={effect.cropCode}
                className={cn(
                  EFFECT_GRID_CLASS,
                  'border-t py-2 text-[13px] tabular-nums',
                )}
              >
                <TruncatedTooltip
                  content={effect.cropName}
                  className="truncate"
                >
                  {effect.cropName}
                </TruncatedTooltip>
                <span className="text-right text-muted-foreground">
                  {formatDbDkk(effect.dbDkkHa - effect.deltaDkkHa)}
                </span>
                <span className="text-right font-semibold">
                  {formatDbDkk(effect.dbDkkHa)}
                </span>
                <span className="text-right">
                  <DbDelta change={effect.deltaDkkHa} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {note ? (
        <p
          className={cn(
            'px-4 pt-1 pb-3.5 text-xs text-muted-foreground',
            moved.length > 0 && 'border-t pt-2.5',
          )}
        >
          {note}
        </p>
      ) : null}
    </section>
  )
}

type EconomicsGuidePageProps = {
  farmName: string
  simulations: Simulation[]
  onOpenSimulation: (simulationId: string) => void
}

type GuideProps = EconomicsGuidePageProps & {
  assumptions: EconomicsAssumptions
  profile: EconomicsProfile
  origin: GuideOrigin | null
  originSimulation: Simulation | undefined
}

const Guide = ({
  assumptions,
  profile,
  origin,
  originSimulation,
  farmName,
  simulations,
  onOpenSimulation,
}: GuideProps) => {
  const titleId = useId()
  const navigate = useNavigate()
  const economics = useEconomicsProfiles()
  const [step, setStep] = useState(1)
  const [sheet, setSheet] = useState({ cropCode: 0, open: false })
  const [name, setName] = useState(profile.name)
  const [startOverrides] = useState(profile.overrides)
  const [overrides, setOverrides] = useState(profile.overrides)
  const [toggledUses, setToggledUses] = useState<string[]>([])

  const changes = profileChanges(assumptions, overrides)
  const changedSteps = new Set<number | null>(
    changes.map((entry) => entry.guideStep),
  )
  const users = economics.findProfile(profile.id)
    ? economics.simulationsUsingProfile(simulations, profile.id)
    : []
  const sharedNote = sharedProfileNote(users.length)
  const [saving, setSaving] = useState(false)
  const nameError = saving ? null : economics.nameError(name, profile.id)
  const sheetCrop = assumptions.crops.find(
    (crop) => crop.cropCode === sheet.cropCode,
  )
  const current = STEPS[step - 1]
  const usageOptions: GuideUseOption[] = simulations.map((simulation) => ({
    id: simulation.id,
    label: simulation.name,
    note: `Valgt profil: ${economics.profileForSimulation(simulation).name}`,
    checked:
      (simulation === originSimulation || users.includes(simulation)) !==
      toggledUses.includes(simulation.id),
  }))
  const dirty =
    name.trim() !== profile.name ||
    !sameOverrides(overrides, profile.overrides) ||
    toggledUses.length > 0

  const leaveGuard = useLeaveGuard(dirty)

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

  const finish = async () => {
    if (nameError || saving) return
    setSaving(true)
    const profileId = await economics.saveProfile(profile.id, name, (current) =>
      applyOverrideEdits(current, startOverrides, overrides),
    )
    if (profileId === null) {
      setSaving(false)
      return
    }
    leaveGuard.release()
    await Promise.all(
      simulations.flatMap((simulation) => {
        const option = usageOptions.find((entry) => entry.id === simulation.id)
        const uses = users.includes(simulation)
        return option && option.checked !== uses
          ? [
              economics.assignProfile(
                simulation,
                option.checked ? profileId : STANDARD_PROFILE_ID,
              ),
            ]
          : []
      }),
    )
    setToggledUses([])
    const chosen = usageOptions.filter((option) => option.checked)
    const opened =
      chosen.find((option) => option.id === originSimulation?.id) ??
      (chosen.length === 1 ? chosen[0] : undefined)
    if (opened) onOpenSimulation(opened.id)
    else navigate(economics.profilePath(profileId))
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
                usageOptions={usageOptions}
                onNameChange={setName}
                onRestore={(entry) =>
                  setOverrides((draft) =>
                    withoutProfileChange(assumptions, draft, entry),
                  )
                }
                onRestoreAll={() =>
                  setOverrides((draft) =>
                    withoutProfileChanges(assumptions, draft),
                  )
                }
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
                  loading={saving}
                  onClick={(event) => {
                    if (event.detail < 2) void finish()
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
      <LeaveFlowDialog
        blocker={leaveGuard.blocker}
        title="Forlad guiden uden at gemme?"
        description={
          <>
            Ændringerne i{' '}
            <b className="font-semibold text-foreground">
              {name.trim() || profile.name}
            </b>{' '}
            gemmes først, når du klikker Færdig under Gennemgang. Forlader du
            siden nu, går de tabt.
          </>
        }
      />
    </div>
  )
}

export const EconomicsGuidePage = (props: EconomicsGuidePageProps) => {
  const { profileId } = useParams()
  const { state } = useLocation()
  const economics = useEconomicsProfiles()
  const origin = guideOriginSchema.safeParse(state)
  const originSimulation = props.simulations.find(
    (simulation) =>
      origin.success && simulation.id === origin.data.guide.simulationId,
  )
  const budgets = useEconomicsAssumptions(
    originSimulation?.fertiliser.farmingSystem,
  )
  const profile =
    (profileId ? economics.findProfile(profileId) : undefined) ??
    (profileId && origin.success
      ? {
          id: profileId,
          name: economics.newProfileName(
            `${props.farmName} ${ROTATION_START_CALENDAR_YEAR}`,
          ),
          overrides: NO_OVERRIDES,
          revision: 0,
        }
      : undefined)

  if (!economics.ready) {
    return <ProfilesStatus className="mx-6 mt-10 sm:mx-10" />
  }
  if (!profile || profile.id === STANDARD_PROFILE_ID) {
    return <Navigate to={economics.overviewPath} replace />
  }

  return (
    <BudgetsGate budgets={budgets} className="mx-6 mt-10 sm:mx-10">
      {(assumptions) => (
        <Guide
          key={profile.id}
          assumptions={assumptions}
          profile={profile}
          origin={origin.success ? origin.data.guide : null}
          originSimulation={originSimulation}
          {...props}
        />
      )}
    </BudgetsGate>
  )
}
