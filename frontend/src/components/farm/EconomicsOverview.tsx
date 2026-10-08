import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Simulation } from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { useStartGuide } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { DbDelta, DbDeltaBar } from '@/components/farm/economics-ui'
import { EconomicsBanner } from '@/components/farm/EconomicsBanner'
import { KeyFigure, OverviewCard } from '@/components/farm/OverviewCard'
import { TruncatedTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cropGroupFor } from '@/lib/crop-groups'
import {
  dbDeltaScale,
  describeProfileChanges,
  formatDbDkk,
  profileChanges,
  profileDbEffect,
  type CropDbEffect,
  type DbDeltaScale,
} from '@/lib/economics'
import {
  describeProfileUsers,
  describeStandard,
  ECONOMICS_INVITATION,
  PROFILES_NOT_IN_CALCULATION,
  STANDARD_PROFILE,
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

type DbEffectListProps = {
  effects: CropDbEffect[]
  scale: DbDeltaScale
}

const DbEffectList = ({ effects, scale }: DbEffectListProps) => (
  <div>
    <p className="flex justify-between gap-3 text-xs text-muted-foreground">
      <span>Dækningsbidrag, kr/ha</span>
      <span>I forhold til Standard</span>
    </p>
    <ul
      aria-label="Dækningsbidrag pr. ha for hver afgrøde"
      className="mt-1.5 grid grid-cols-[minmax(0,10rem)_minmax(2rem,1fr)_auto_3.5rem] gap-x-3 text-[13px] tabular-nums"
    >
      {effects.map((effect) => {
        const moved = effect.deltaDkkHa !== 0
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
              <TruncatedTooltip content={effect.cropName} className="truncate">
                {effect.cropName}
              </TruncatedTooltip>
            </span>
            <DbDeltaBar delta={effect.deltaDkkHa} scale={scale} />
            <span className={cn('text-right', moved && 'font-semibold')}>
              {formatDbDkk(effect.dbDkkHa)}
            </span>
            <span className="text-right">
              <DbDelta change={effect.deltaDkkHa} />
              {moved ? (
                <span className="sr-only"> i forhold til Standard</span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  </div>
)

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
  const startGuide = useStartGuide()
  const changes = profileChanges(economics.assumptions, profile.overrides)
  const movedCrops = effects.filter((effect) => effect.deltaDkkHa !== 0).length

  return (
    <OverviewCard
      title={profile.name}
      subtitle={describeProfileUsers(
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
  const startGuide = useStartGuide()
  const cards = economics.ownProfiles.map((profile) => ({
    profile,
    effects: profileDbEffect(economics.assumptions, profile.overrides),
  }))
  const scale = dbDeltaScale(
    cards.flatMap((card) => card.effects.map((effect) => effect.deltaDkkHa)),
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
            </p>
            <p className="mt-1 text-sm text-warning-strong">
              {PROFILES_NOT_IN_CALCULATION}
            </p>
          </div>
          <Button onClick={startFromStandard}>
            <Plus aria-hidden="true" />
            Ny økonomiprofil
          </Button>
        </header>
        <EconomicsBanner
          label="Standard"
          title={STANDARD_PROFILE.name}
          text={describeStandard(
            economics.assumptions.crops.length,
            economics
              .simulationsUsingProfile(simulations, STANDARD_PROFILE_ID)
              .map((simulation) => simulation.name),
          )}
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
