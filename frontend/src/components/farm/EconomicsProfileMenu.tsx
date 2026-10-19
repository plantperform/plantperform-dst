import { Check, ChevronDown, List, Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Simulation } from '@/api/types'
import { useStartGuide } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { profileChanges, type EconomicsAssumptions } from '@/lib/economics'
import {
  describeProfileOption,
  STANDARD_PROFILE_ID,
} from '@/lib/economics-profiles'

type EconomicsProfileMenuProps = {
  assumptions: EconomicsAssumptions | undefined
  simulation: Simulation
  simulations: Simulation[]
}

export const EconomicsProfileMenu = ({
  assumptions,
  simulation,
  simulations,
}: EconomicsProfileMenuProps) => {
  const economics = useEconomicsProfiles()
  const startGuide = useStartGuide()
  const profile = economics.profileForSimulation(simulation)
  const known = economics.findProfile(profile.id) !== undefined
  const isStandard = profile.id === STANDARD_PROFILE_ID

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-full">
          <span className="truncate">{profile.name}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {economics.profiles.map((option) => (
          <DropdownMenuItem
            key={option.id}
            aria-current={option.id === profile.id ? 'true' : undefined}
            onSelect={() => void economics.assignProfile(simulation, option.id)}
          >
            {option.id === profile.id ? (
              <Check className="mr-2 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <span className="mr-2 size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium">{option.name}</span>
              <span className="block text-xs text-muted-foreground">
                {describeProfileOption(
                  option.id,
                  assumptions
                    ? profileChanges(assumptions, option.overrides).length
                    : null,
                  economics
                    .simulationsUsingProfile(simulations, option.id)
                    .map((entry) => entry.name),
                )}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            startGuide({
              fromProfileId: profile.id,
              simulationId: simulation.id,
            })
          }
        >
          <Pencil className="mr-2 size-4 shrink-0" aria-hidden="true" />
          {isStandard || !known
            ? 'Tilpas økonomien til bedriften'
            : 'Tilpas i guiden'}
        </DropdownMenuItem>
        {known ? (
          <DropdownMenuItem asChild>
            <Link
              to={economics.profilePath(profile.id)}
              state={{
                returnTo: {
                  kind: 'simulation',
                  simulationId: simulation.id,
                  name: simulation.name,
                },
              }}
              onClick={() =>
                economics.setFarmingSystem(simulation.fertiliser.farmingSystem)
              }
            >
              <List className="mr-2 size-4 shrink-0" aria-hidden="true" />
              Se alle poster i {profile.name}
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
