import { ArrowRight, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import type { FieldRecord, Simulation } from '@/api/types'
import { useEconomicsNavigation } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { EconomicsBanner } from '@/components/farm/EconomicsBanner'
import { HistoryCard, SimulationCard } from '@/components/farm/SimulationCard'
import type {
  FarmInspectorMode,
  FarmViewSelection,
} from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  describeEconomicsEntry,
  STANDARD_PROFILE_ID,
} from '@/lib/economics-profiles'
import { resolveFarmQuota } from '@/lib/field-domain'

type SimulationOverviewProps = {
  farmId: string
  fields: FieldRecord[]
  simulations: Simulation[]
  selection: FarmViewSelection
  copyingSimulationId: string | null
  deletingSimulationId: string | null
  onOpen: (selection: FarmViewSelection, mode: FarmInspectorMode) => void
  onCopySimulation: (simulation: Simulation) => void
  onDeleteSimulation: (simulation: Simulation) => void
  onNewSimulation: () => void
}

export const SimulationOverview = ({
  farmId,
  fields,
  simulations,
  selection,
  copyingSimulationId,
  deletingSimulationId,
  onOpen,
  onCopySimulation,
  onDeleteSimulation,
  onNewSimulation,
}: SimulationOverviewProps) => {
  const historyQuota = useMemo(() => resolveFarmQuota(fields, false), [fields])
  const economics = useEconomicsProfiles()
  const { startGuide } = useEconomicsNavigation()
  const ownProfiles = economics.profiles.filter(
    (profile) => profile.id !== STANDARD_PROFILE_ID,
  )
  const economicsEntry = describeEconomicsEntry(
    ownProfiles.map((profile) => ({
      name: profile.name,
      simulationNames: economics
        .simulationsUsingProfile(simulations, profile.id)
        .map((simulation) => simulation.name),
    })),
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container mx-auto flex max-w-[96rem] flex-col gap-5 px-6 pt-10 pb-16 sm:px-10">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-4xl tracking-tight">
              Simuleringer
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              En simulering er en kopi af bedriftens marker, som du kan ændre og
              optimere uden at røre afgrødehistorikken. Tallene er gennemsnit
              pr. år, og under dem står forskellen til afgrødehistorikken.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {simulations.length > 0 ? (
              <Button variant="outline" asChild>
                <Link to={`/farms/${farmId}/simulations/compare`}>
                  Sammenlign
                </Link>
              </Button>
            ) : null}
            <Button onClick={onNewSimulation}>
              <Plus aria-hidden="true" />
              Ny simulering
            </Button>
          </div>
        </header>
        <EconomicsBanner
          label="Økonomi"
          title={economicsEntry.title}
          text={economicsEntry.text}
        >
          {ownProfiles.length > 0 ? (
            <Button variant="outline" size="sm" asChild>
              <Link
                to={economics.profilePath(ownProfiles[0].id)}
                state={{ returnTo: { kind: 'overview' } }}
              >
                Se profilerne
              </Link>
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => startGuide({ fromProfileId: STANDARD_PROFILE_ID })}
          >
            {ownProfiles.length > 0
              ? 'Tilpas igen'
              : 'Tilpas økonomien til bedriften'}
            <ArrowRight aria-hidden="true" />
          </Button>
        </EconomicsBanner>
        <div className="grid gap-4 @3xl:grid-cols-2 @7xl:grid-cols-3">
          <HistoryCard
            farmId={farmId}
            fields={fields}
            quota={historyQuota}
            active={selection.kind === 'current'}
            onOpen={() => onOpen({ kind: 'current' }, 'values')}
            onCopy={onNewSimulation}
          />
          {simulations.map((simulation) => (
            <SimulationCard
              key={simulation.id}
              farmId={farmId}
              simulation={simulation}
              liveFields={fields}
              history={historyQuota}
              active={
                selection.kind === 'simulation' &&
                selection.id === simulation.id
              }
              copying={copyingSimulationId === simulation.id}
              deleting={deletingSimulationId === simulation.id}
              onOpen={(mode) =>
                onOpen({ kind: 'simulation', id: simulation.id }, mode)
              }
              onCopy={() => onCopySimulation(simulation)}
              onDelete={() => onDeleteSimulation(simulation)}
            />
          ))}
          {simulations.length === 0 ? (
            <Card className="flex flex-col items-start justify-center gap-3 border-dashed p-6">
              <h2 className="font-display text-[19px] leading-6">
                Ingen simuleringer endnu
              </h2>
              <p className="text-sm text-muted-foreground">
                Lav en simulering for at prøve andre sædskifter og virkemidler,
                eller lad Optimér finde det bedste dækningsbidrag inden for
                kvoten.
              </p>
              <Button onClick={onNewSimulation}>
                Lav den første simulering
              </Button>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
