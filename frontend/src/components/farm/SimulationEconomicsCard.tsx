import { useId } from 'react'
import { Link } from 'react-router-dom'

import type { Simulation } from '@/api/types'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import {
  RULES_CARD_CLASS,
  RULES_CARD_HEAD_CLASS,
} from '@/components/farm/rules-ui'
import { STANDARD_PROFILE_ID } from '@/lib/economics-profiles'

type SimulationEconomicsCardProps = {
  simulation: Simulation
}

export const SimulationEconomicsCard = ({
  simulation,
}: SimulationEconomicsCardProps) => {
  const id = useId()
  const economics = useEconomicsProfiles()
  const profile = economics.profileForSimulation(simulation.id)

  return (
    <section className={RULES_CARD_CLASS} aria-labelledby={`${id}-title`}>
      <div className={RULES_CARD_HEAD_CLASS}>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            Økonomiprofil
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Priser og mængder bag dækningsbidraget i simuleringen. Profilerne
            rettes under Økonomiprofiler i sidebaren.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-3">
        <select
          aria-labelledby={`${id}-title`}
          className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          value={profile.id}
          onChange={(event) =>
            economics.assignProfile(simulation.id, event.target.value)
          }
        >
          {economics.profiles.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <Link
          to={economics.profilePath(profile.id)}
          className="rounded-sm text-[13px] font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Se profilen
        </Link>
        {profile.id === STANDARD_PROFILE_ID ? null : (
          <p className="w-full text-xs text-amber-800">
            Profilen indgår ikke i beregningen endnu.
          </p>
        )}
      </div>
    </section>
  )
}
