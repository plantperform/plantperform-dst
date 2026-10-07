import { Check, ChevronDown, List, Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Simulation } from '@/api/types'
import { useStartGuide } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { NotInCalculationDot } from '@/components/farm/economics-ui'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { profileChanges } from '@/lib/economics'
import {
  describeProfileOption,
  STANDARD_PROFILE_ID,
} from '@/lib/economics-profiles'

type SimulationHeadingProps = {
  simulation: Simulation
  simulations: Simulation[]
}

export const SimulationHeading = ({
  simulation,
  simulations,
}: SimulationHeadingProps) => {
  const economics = useEconomicsProfiles()
  const startGuide = useStartGuide()
  const profile = economics.profileForSimulation(simulation.id)
  const isStandard = profile.id === STANDARD_PROFILE_ID

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-0.5">
      <h2 className="min-w-0 truncate font-display text-xl leading-7 tracking-tight">
        {simulation.name}
      </h2>
      <span className="text-[13px] text-muted-foreground">regner med</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="xs" className="max-w-full">
            <span className="truncate">{profile.name}</span>
            {isStandard ? null : <NotInCalculationDot />}
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {economics.profiles.map((option) => (
            <DropdownMenuItem
              key={option.id}
              aria-current={option.id === profile.id ? 'true' : undefined}
              onSelect={() => economics.assignProfile(simulation.id, option.id)}
            >
              {option.id === profile.id ? (
                <Check className="mr-2 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <span className="mr-2 size-4 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {option.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {describeProfileOption(
                    option.id,
                    profileChanges(economics.assumptions, option.overrides)
                      .length,
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
            {isStandard ? 'Tilpas økonomien til bedriften' : 'Tilpas i guiden'}
          </DropdownMenuItem>
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
            >
              <List className="mr-2 size-4 shrink-0" aria-hidden="true" />
              Se alle poster i {profile.name}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
