import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Simulation } from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { useEconomicsNavigation } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { EconomicsBanner } from '@/components/farm/EconomicsBanner'
import { KeyFigure, OverviewCard } from '@/components/farm/OverviewCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  dbDeltaBar,
  dbDeltaScale,
  describeProfileChanges,
  formatCropCount,
  formatDbDkk,
  formatSignedDkk,
  leadingDbEffects,
  profileChanges,
  profileDbEffect,
  type CropDbEffect,
  type DbDeltaScale,
} from '@/lib/economics'
import {
  describeProfileUsers,
  describeStandardEntry,
  ECONOMICS_INVITATION,
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

const SHOWN_CROPS = 6

type DbEffectListProps = {
  effects: CropDbEffect[]
  scale: DbDeltaScale
}

const DbEffectList = ({ effects, scale }: DbEffectListProps) => {
  const shown = leadingDbEffects(effects, SHOWN_CROPS)
  const hiddenCrops = effects.length - shown.length

  return (
    <div>
      <p className="flex justify-between gap-3 text-xs text-muted-foreground">
        <span>Dækningsbidrag, kr/ha</span>
        <span>I forhold til Standard</span>
      </p>
      <ul
        aria-label="Dækningsbidrag pr. ha for hver afgrøde"
        className="mt-1.5 grid grid-cols-[minmax(0,10rem)_minmax(2rem,1fr)_auto_3.5rem] gap-x-3 text-[13px] tabular-nums"
      >
        {shown.map((effect) => {
          const moved = effect.deltaDkkHa !== 0
          const rises = effect.deltaDkkHa > 0
          const bar = dbDeltaBar(effect.deltaDkkHa, scale)
          return (
            <li
              key={effect.cropCode}
              className={cn(
                'col-span-4 grid h-7 grid-cols-subgrid items-center',
                !moved && 'text-muted-foreground',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CropGroupTile
                  group={cropGroupFor(effect.cropCode, effect.cropName)}
                  className={moved ? undefined : 'opacity-50'}
                />
                <span className="truncate" title={effect.cropName}>
                  {effect.cropName}
                </span>
              </span>
              <span aria-hidden="true" className="relative h-full">
                {moved ? (
                  <span
                    className={cn(
                      'absolute top-2.5 h-2 min-w-0.5',
                      rises
                        ? 'rounded-r-[2px] bg-primary/75'
                        : 'rounded-l-[2px] bg-destructive/75',
                    )}
                    style={{
                      width: `${bar.width * 100}%`,
                      ...(rises
                        ? { left: `${bar.axis * 100}%` }
                        : { right: `${(1 - bar.axis) * 100}%` }),
                    }}
                  />
                ) : null}
                <span
                  className="absolute inset-y-0 w-px bg-foreground/20"
                  style={{ left: `${bar.axis * 100}%` }}
                />
              </span>
              <span className={cn('text-right', moved && 'font-semibold')}>
                {formatDbDkk(effect.dbDkkHa)}
              </span>
              <span
                className={cn(
                  'text-right',
                  rises ? 'text-primary' : 'text-destructive',
                )}
              >
                {moved ? (
                  <>
                    {formatSignedDkk(effect.deltaDkkHa)}
                    <span className="sr-only"> i forhold til Standard</span>
                  </>
                ) : null}
              </span>
            </li>
          )
        })}
        {hiddenCrops > 0 ? (
          <li className="col-span-4 flex h-7 items-center text-muted-foreground">
            og {formatCropCount(hiddenCrops)} mere
          </li>
        ) : null}
      </ul>
    </div>
  )
}

type ProfileCardProps = {
  profile: EconomicsProfile
  effects: CropDbEffect[]
  scale: DbDeltaScale
  simulations: Simulation[]
  onDelete: () => void
}

const ProfileCard = ({
  profile,
  effects,
  scale,
  simulations,
  onDelete,
}: ProfileCardProps) => {
  const economics = useEconomicsProfiles()
  const { startGuide } = useEconomicsNavigation()
  const changes = profileChanges(economics.assumptions, profile.overrides)
  const movedCrops = effects.filter((effect) => effect.deltaDkkHa !== 0).length

  return (
    <OverviewCard
      title={profile.name}
      subtitle={describeProfileUsers(
        profile.id,
        economics
          .simulationsUsingProfile(simulations, profile.id)
          .map((simulation) => simulation.name),
      )}
      actions={
        <>
          <Button size="xs" asChild>
            <Link
              to={economics.profilePath(profile.id)}
              aria-label={`Åbn ${profile.name}`}
            >
              Åbn
            </Link>
          </Button>
          <Button
            size="xs"
            variant="outline"
            aria-label={`Tilpas i guiden: ${profile.name}`}
            onClick={() => startGuide({ fromProfileId: profile.id })}
          >
            Tilpas i guiden
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="text-destructive hover:text-destructive"
            aria-label={`Slet ${profile.name}`}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
            Slet
          </Button>
        </>
      }
    >
      <div className="grid min-h-20 grid-cols-2 gap-4">
        <KeyFigure
          label="Ændringer"
          figure={{
            value: String(changes.length),
            total: describeProfileChanges(changes),
          }}
        />
        <KeyFigure
          label="Afgrøder"
          figure={{
            value: `${movedCrops} af ${effects.length}`,
            total: 'med ændret dækningsbidrag',
          }}
        />
      </div>
      <DbEffectList effects={effects} scale={scale} />
    </OverviewCard>
  )
}

type EconomicsOverviewProps = {
  simulations: Simulation[]
  onDeleteProfile: (profile: EconomicsProfile) => void
}

export const EconomicsOverview = ({
  simulations,
  onDeleteProfile,
}: EconomicsOverviewProps) => {
  const economics = useEconomicsProfiles()
  const { startGuide } = useEconomicsNavigation()
  const cards = economics.profiles
    .filter((profile) => profile.id !== STANDARD_PROFILE_ID)
    .map((profile) => ({
      profile,
      effects: profileDbEffect(economics.assumptions, profile.overrides),
    }))
  const scale = dbDeltaScale(cards.flatMap((card) => card.effects))
  const standard = describeStandardEntry(
    economics.assumptions.crops.length,
    economics
      .simulationsUsingProfile(simulations, STANDARD_PROFILE_ID)
      .map((simulation) => simulation.name),
  )
  const startFromStandard = () =>
    startGuide({ fromProfileId: STANDARD_PROFILE_ID })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container mx-auto flex max-w-[96rem] flex-col gap-5 px-6 pt-10 pb-16 sm:px-10">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-4xl tracking-tight">Økonomi</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              En økonomiprofil er bedriftens egne priser, mængder og udbytter
              oven på Standard, og hver simulering regner med en af profilerne.
              Kortene viser dækningsbidraget pr. ha for hver afgrøde, og bjælken
              viser forskellen til Standard.
            </p>
            <p className="mt-1 text-sm text-amber-800">
              Profilerne gemmes kun i denne browser og indgår ikke i beregningen
              endnu.
            </p>
          </div>
          <Button onClick={startFromStandard}>
            <Plus aria-hidden="true" />
            Ny økonomiprofil
          </Button>
        </header>
        <EconomicsBanner
          label="Standard"
          title={standard.title}
          text={standard.text}
        >
          <Button variant="outline" size="sm" asChild>
            <Link to={economics.profilePath(STANDARD_PROFILE_ID)}>
              Se Standard
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </EconomicsBanner>
        <div className="grid auto-rows-fr gap-4 @3xl:grid-cols-2 @7xl:grid-cols-3">
          {cards.map(({ profile, effects }) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              effects={effects}
              scale={scale}
              simulations={simulations}
              onDelete={() => onDeleteProfile(profile)}
            />
          ))}
          {cards.length === 0 ? (
            <Card className="flex flex-col items-start justify-center gap-3 border-dashed p-6">
              <h2 className="font-display text-[19px] leading-6">
                Ingen egne profiler endnu
              </h2>
              <p className="text-sm text-muted-foreground">
                {ECONOMICS_INVITATION}
              </p>
              <Button onClick={startFromStandard}>
                Tilpas økonomien til bedriften
              </Button>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
