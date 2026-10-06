import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import type { Simulation } from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { guideOriginSchema } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { EconomicsCropDetail } from '@/components/farm/EconomicsCropDetail'
import {
  GuideMachinesStep,
  GuidePricesStep,
  GuideReviewStep,
  GuideYieldStep,
  type GuideUseOption,
} from '@/components/farm/EconomicsGuideSteps'
import { RULES_CARD_CLASS } from '@/components/farm/rules-ui'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  cropDbChange,
  cropTotals,
  formatDbDkk,
  formatSignedDkk,
  guideStepOfChange,
  NO_OVERRIDES,
  profileChanges,
  sameOverrides,
  withoutProfileChange,
  type EconomicsAssumptions,
  type EconomicsOverrides,
  type OverridesChange,
} from '@/lib/economics'
import {
  sharedProfileNote,
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    id: 1,
    label: 'Salgspriser',
    title: 'Har I en salgsaftale eller en anden pris end standarden?',
    intro:
      'Skriv bedriftens salgspris pr. afgrøde. Dækningsbidraget er det, marken tjener pr. ha: udbytte gange salgspris plus tilskud, minus udsæd, planteværn, markarbejde og tørring.',
  },
  {
    id: 2,
    label: 'Udbytte',
    title: 'Høster I typisk mere eller mindre end normen?',
    intro:
      'Sæt procenten pr. afgrøde. Den ændrer mængden af kerne og halm, men ikke omkostningerne.',
  },
  {
    id: 3,
    label: 'Maskinstation',
    title: 'Hvad betaler I for markarbejdet?',
    intro:
      'Priserne fra maskinstationen eller egne maskiner. En fælles pris gælder for alle de afgrøder, der står ved den, i hele profilen.',
  },
  {
    id: 4,
    label: 'Gennemgang',
    title: 'Det har I ændret i forhold til Standard',
    intro:
      'Gå listen igennem, giv profilen et navn og vælg, hvor den skal bruges. Resten af posterne kan rettes bagefter på profilens side.',
  },
] as const

const LAST_STEP = STEPS.length

const USE_NEW_SIMULATION = 'new'

const USE_PROFILE_ONLY = 'none'

type GuideEffectProps = {
  assumptions: EconomicsAssumptions
  overrides: EconomicsOverrides
}

const GuideEffect = ({ assumptions, overrides }: GuideEffectProps) => (
  <section className={cn(RULES_CARD_CLASS, 'overflow-hidden')}>
    <div className="px-4 pt-3.5 pb-2.5">
      <Eyebrow>Sådan påvirker det dækningsbidraget</Eyebrow>
      <p className="mt-0.5 text-xs text-muted-foreground">
        kr/ha · Standard mod jeres tal
      </p>
    </div>
    <ul>
      {assumptions.crops.map((crop) => {
        const change = cropDbChange(assumptions, overrides, crop)
        return (
          <li
            key={crop.cropCode}
            className="grid grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.25rem] items-center gap-x-2 border-t px-4 py-2 text-[13px] tabular-nums"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{
                  backgroundColor: cropGroupFor(crop.cropCode, crop.cropName)
                    .color,
                }}
                aria-hidden="true"
              />
              <span className="truncate">{crop.cropName}</span>
            </span>
            <span className="text-right text-muted-foreground">
              {formatDbDkk(cropTotals(assumptions, NO_OVERRIDES, crop).dbDkkHa)}
            </span>
            <span className={cn('text-right', change !== 0 && 'font-semibold')}>
              {formatDbDkk(cropTotals(assumptions, overrides, crop).dbDkkHa)}
            </span>
            <span
              className={cn(
                'text-right',
                change > 0 ? 'text-primary' : 'text-destructive',
              )}
            >
              {change === 0 ? null : formatSignedDkk(change)}
            </span>
          </li>
        )
      })}
    </ul>
  </section>
)

type EconomicsGuidePageProps = {
  farmName: string
  simulations: Simulation[]
  onOpenSimulation: (simulationId: string) => void
  onNewSimulation: (profileId: string) => void
}

type GuideProps = EconomicsGuidePageProps & { profile: EconomicsProfile }

const Guide = ({
  profile,
  farmName,
  simulations,
  onOpenSimulation,
  onNewSimulation,
}: GuideProps) => {
  const titleId = useId()
  const location = useLocation()
  const navigate = useNavigate()
  const economics = useEconomicsProfiles()
  const { assumptions } = economics
  const origin = guideOriginSchema.safeParse(location.state)
  const startedFrom = origin.success ? origin.data.guide : null
  const originSimulation = simulations.find(
    (simulation) => simulation.id === startedFrom?.simulationId,
  )
  const [step, setStep] = useState(1)
  const [openCropCode, setOpenCropCode] = useState<number | null>(null)
  const [name, setName] = useState(profile.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [chosenUse, setChosenUse] = useState(
    originSimulation?.id ?? USE_PROFILE_ONLY,
  )

  const changes = profileChanges(assumptions, profile.overrides)
  const changedSteps = new Set<number | null>(changes.map(guideStepOfChange))
  const users = economics.simulationsUsingProfile(simulations, profile.id)
  const sharedNote = sharedProfileNote(users.length)
  const change = (update: OverridesChange) =>
    economics.changeOverrides(profile.id, update)
  const openCrop = assumptions.crops.find(
    (crop) => crop.cropCode === openCropCode,
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
    const source = profile.copiedFromId
      ? economics.findProfile(profile.copiedFromId)
      : undefined
    const untouched =
      startedFrom?.created === true &&
      users.length === 0 &&
      sameOverrides(profile.overrides, source?.overrides ?? NO_OVERRIDES)
    if (untouched) economics.deleteProfile(profile.id)
    if (originSimulation) onOpenSimulation(originSimulation.id)
    else navigate(startedFrom?.returnTo ?? economics.profilePath(profile.id))
  }

  const finish = () => {
    const error = economics.nameError(name, profile.id)
    if (error) {
      setNameError(error)
      return
    }
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
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 pt-10 pb-16 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-4xl tracking-tight break-words">
              Tilpas økonomien til {farmName}
            </h1>
            <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
              Standarden er SEGES Budgetkalkuler 2026. Her retter du de få tal,
              der plejer at betyde mest for dækningsbidraget. Alt andet kan
              rettes bagefter på profilens side. Ændringerne gemmes med det
              samme i{' '}
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
                  'inline-flex h-10 items-center gap-2 rounded-full border py-0 pr-4 pl-2.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  entry.id === step
                    ? 'border-foreground bg-foreground text-background'
                    : 'bg-card hover:bg-muted',
                )}
                onClick={() => setStep(entry.id)}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-xs',
                    entry.id === step ? 'bg-background/20' : 'bg-muted',
                  )}
                >
                  {entry.id}
                </span>
                {entry.label}
                {changedSteps.has(entry.id) ? (
                  <span className="size-1.5 rounded-full bg-amber-500">
                    <span className="sr-only">(har ændringer)</span>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <section
            aria-labelledby={titleId}
            className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
          >
            <div className="px-5 pt-4 pb-3.5">
              <h2 id={titleId} className="text-[17px] font-semibold">
                {current.title}
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
                onOpenCrop={setOpenCropCode}
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
                onNameChange={(next) => {
                  setName(next)
                  setNameError(null)
                }}
                onRestore={(entry) =>
                  change((overrides) =>
                    withoutProfileChange(assumptions, overrides, entry),
                  )
                }
                onRestoreAll={() => change(() => NO_OVERRIDES)}
                onUseChoiceChange={setChosenUse}
              />
            ) : null}
            <div className="grid grid-cols-3 items-center gap-3 border-t px-5 py-4">
              <div>
                {step > 1 ? (
                  <Button variant="outline" onClick={() => setStep(step - 1)}>
                    <ArrowLeft aria-hidden="true" />
                    Tilbage
                  </Button>
                ) : null}
              </div>
              <p className="text-center text-[13px] text-muted-foreground">
                Trin {step} af {LAST_STEP}
              </p>
              <div className="flex justify-end">
                {step < LAST_STEP ? (
                  <Button onClick={() => setStep(step + 1)}>
                    Næste
                    <ArrowRight aria-hidden="true" />
                  </Button>
                ) : (
                  <Button onClick={finish}>
                    <Check aria-hidden="true" />
                    Færdig
                  </Button>
                )}
              </div>
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
                Det, marken tjener pr. ha: udbytte gange salgspris plus
                grundbetaling, minus udsæd, planteværn, markarbejde og tørring.
                Gødning regnes ud fra kvælstofnormen i hver simulering og er
                ikke med her.
              </p>
            </section>
          </aside>
        </div>
      </div>

      <Sheet
        open={openCrop !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpenCropCode(null)
        }}
      >
        <SheetContent
          showCloseButton={false}
          className="w-full gap-0 sm:max-w-3xl"
        >
          <div className="flex items-center gap-3.5 border-b bg-card px-6 py-4">
            {openCrop ? (
              <CropGroupTile
                group={cropGroupFor(openCrop.cropCode, openCrop.cropName)}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-display text-[22px] font-normal">
                {openCrop?.cropName}
              </SheetTitle>
              <SheetDescription className="text-[13px]">
                Sådan er dækningsbidraget bygget i {profile.name}. Tallene i
                felterne kan rettes.
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
            {openCrop ? (
              <div className={cn(RULES_CARD_CLASS, 'overflow-hidden')}>
                <EconomicsCropDetail
                  key={openCrop.cropCode}
                  assumptions={assumptions}
                  overrides={profile.overrides}
                  crop={openCrop}
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
  const economics = useEconomicsProfiles()
  const profile = profileId ? economics.findProfile(profileId) : undefined

  if (!profile || profile.id === STANDARD_PROFILE_ID) {
    return <Navigate to={economics.profilePath(STANDARD_PROFILE_ID)} replace />
  }

  return <Guide key={profile.id} profile={profile} {...props} />
}
