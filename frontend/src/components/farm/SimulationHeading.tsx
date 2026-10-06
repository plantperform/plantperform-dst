import { Check, ChevronDown, Coins, List, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { FieldRecord, Simulation } from '@/api/types'
import { useEconomicsNavigation } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { NotInCalculationDot } from '@/components/farm/EconomicsChip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { profileChanges } from '@/lib/economics'
import {
  describeProfileOption,
  STANDARD_PROFILE_ID,
} from '@/lib/economics-profiles'
import { formatFieldCount, formatNumber } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

const OPTION_CLASS =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

const ACTION_CLASS = cn(
  OPTION_CLASS,
  'gap-2 text-[13px] font-medium text-primary',
)

type SimulationHeadingProps = {
  simulation: Simulation
  simulations: Simulation[]
  fields: FieldRecord[] | undefined
}

export const SimulationHeading = ({
  simulation,
  simulations,
  fields,
}: SimulationHeadingProps) => {
  const economics = useEconomicsProfiles()
  const { startGuide } = useEconomicsNavigation()
  const [open, setOpen] = useState(false)
  const profile = economics.profileForSimulation(simulation.id)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-0.5">
      <h2 className="font-display text-xl leading-7 tracking-tight">
        {simulation.name}
      </h2>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        <span>
          Simulering
          {fields && fields.length > 0
            ? ` · ${formatFieldCount(fields.length)} · ${formatNumber(
                fields.reduce((total, field) => total + field.areaHa, 0),
              )} ha`
            : null}{' '}
          · regner med
        </span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Økonomi: ${profile.name}. Skift økonomiprofil`}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-card px-2 text-[12.5px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Coins className="size-3.5" aria-hidden="true" />
              {profile.name}
              {profile.id === STANDARD_PROFILE_ID ? null : (
                <NotInCalculationDot />
              )}
              <ChevronDown
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[380px] max-w-[calc(100vw-2rem)] p-1.5"
          >
            <ul>
              {economics.profiles.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-pressed={option.id === profile.id}
                    className={cn(
                      OPTION_CLASS,
                      option.id === profile.id && 'bg-muted',
                    )}
                    onClick={() => {
                      economics.assignProfile(simulation.id, option.id)
                      setOpen(false)
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-foreground">
                        {option.name}
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {describeProfileOption(
                          option.id,
                          profileChanges(
                            economics.assumptions,
                            option.overrides,
                          ).length,
                          economics
                            .simulationsUsingProfile(simulations, option.id)
                            .map((entry) => entry.name),
                        )}
                      </span>
                    </span>
                    {option.id === profile.id ? (
                      <Check
                        className="size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            <div className="my-1.5 border-t" />
            <button
              type="button"
              className={ACTION_CLASS}
              onClick={() => {
                setOpen(false)
                startGuide({
                  fromProfileId: profile.id,
                  simulationId: simulation.id,
                })
              }}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Tilpas økonomien til bedriften
            </button>
            <Link
              to={economics.profilePath(profile.id)}
              state={{
                returnTo: {
                  kind: 'simulation',
                  simulationId: simulation.id,
                  label: `Tilbage til ${simulation.name}`,
                },
              }}
              className={ACTION_CLASS}
            >
              <List className="size-3.5" aria-hidden="true" />
              Se alle poster i {profile.name}
            </Link>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
