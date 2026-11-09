import { Check, ChevronDown, Coins } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { FarmingSystem, Simulation } from '@/api/types'
import type { ReturnTarget } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import {
  isProfileApplied,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { cn } from '@/lib/utils'

const CHIP_CLASS =
  'inline-flex h-6 max-w-full items-center rounded-full border bg-card text-xs font-medium text-foreground'

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

const SWITCH_CLASS = cn(
  'flex w-6 shrink-0 items-center justify-center rounded-r-full border-l text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none',
  FOCUS_CLASS,
)

type ProfileSwitchProps = {
  simulation: Simulation
  // The profile the figures next to the chip were calculated with.
  shown: EconomicsProfile
}

// The arrow on the chip: picks another profile for the simulation and has it
// recalculated. The spinner stays until the figures are the chosen profile's; the
// column can leave and return meanwhile, so that is not only this component's state.
const ProfileSwitch = ({ simulation, shown }: ProfileSwitchProps) => {
  const economics = useEconomicsProfiles()
  const [changing, setChanging] = useState(false)
  const selected = economics.profileForSimulation(simulation)
  const busy =
    changing ||
    (economics.findProfile(selected.id) !== undefined &&
      !isProfileApplied(selected, shown))

  const choose = async (profileId: string) => {
    setChanging(true)
    try {
      await economics.assignProfile(simulation, profileId, {
        recalculate: true,
      })
    } finally {
      setChanging(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label={`Skift økonomiprofil for ${simulation.name}`}
          title={busy ? 'Genberegner økonomien' : 'Skift økonomiprofil'}
          className={SWITCH_CLASS}
        >
          {busy ? (
            <Spinner className="size-3" />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {economics.profiles.map((option) => (
          <DropdownMenuItem
            key={option.id}
            aria-current={option.id === selected.id ? 'true' : undefined}
            onSelect={() => void choose(option.id)}
          >
            {option.id === selected.id ? (
              <Check className="mr-2 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <span className="mr-2 size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">{option.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type EconomicsChipProps = {
  profile: EconomicsProfile
  farmingSystem: FarmingSystem
  returnTo: ReturnTarget
  // With a simulation, an arrow on the chip lets the profile be switched.
  simulation?: Simulation
  className?: string
}

export const EconomicsChip = ({
  profile,
  farmingSystem,
  returnTo,
  simulation,
  className,
}: EconomicsChipProps) => {
  const { profilePath, findProfile, setFarmingSystem } = useEconomicsProfiles()
  const content = (
    <>
      <Coins className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{profile.name}</span>
    </>
  )
  const linked = findProfile(profile.id) !== undefined
  const open = () => setFarmingSystem(farmingSystem)

  if (simulation) {
    const nameClass =
      'flex min-w-0 items-center gap-1.5 rounded-l-full pr-1.5 pl-2'
    return (
      <span className={cn(CHIP_CLASS, 'items-stretch', className)}>
        {linked ? (
          <Link
            to={profilePath(profile.id)}
            state={{ returnTo }}
            onClick={open}
            className={cn(
              nameClass,
              'transition-colors hover:text-primary',
              FOCUS_CLASS,
            )}
          >
            {content}
          </Link>
        ) : (
          <span className={nameClass}>{content}</span>
        )}
        <ProfileSwitch simulation={simulation} shown={profile} />
      </span>
    )
  }

  if (!linked) {
    return (
      <span className={cn(CHIP_CLASS, 'gap-1.5 pr-2.5 pl-2', className)}>
        {content}
      </span>
    )
  }

  return (
    <Link
      to={profilePath(profile.id)}
      state={{ returnTo }}
      onClick={open}
      className={cn(
        CHIP_CLASS,
        'gap-1.5 pr-2.5 pl-2 transition-colors hover:border-primary hover:text-primary',
        FOCUS_CLASS,
        className,
      )}
    >
      {content}
    </Link>
  )
}
