import type { Simulation } from '@/api/types'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { NotInCalculationDot } from '@/components/farm/economics-ui'
import { STANDARD_PROFILE_ID } from '@/lib/economics-profiles'

type SimulationHeadingProps = {
  simulation: Simulation
}

export const SimulationHeading = ({ simulation }: SimulationHeadingProps) => {
  const economics = useEconomicsProfiles()
  const profile = economics.profileForSimulation(simulation.id)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-0.5">
      <h2 className="min-w-0 truncate font-display text-xl leading-7 tracking-tight">
        {simulation.name}
      </h2>
      <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        <span className="truncate">
          regner med{' '}
          <span className="font-medium text-foreground">{profile.name}</span>
        </span>
        {profile.id === STANDARD_PROFILE_ID ? null : <NotInCalculationDot />}
      </p>
    </div>
  )
}
