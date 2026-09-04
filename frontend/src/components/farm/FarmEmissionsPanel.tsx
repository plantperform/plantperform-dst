import { useFarmEmissions } from '@/api/hooks'
import { formatNumber } from '@/lib/farm-totals'

type FarmEmissionsPanelProps = {
  farmId: string
}

/**
 * Udledningskvote per kystvandopland. The bekendtgørelse enforces the quota per
 * catchment rather than as one farm total, so this lists one chip per opland,
 * inline with the nøgletal it has to be read against.
 */
export const FarmEmissionsPanel = ({ farmId }: FarmEmissionsPanelProps) => {
  const { data: emissionsPerKystvandopland = [] } = useFarmEmissions(farmId)

  if (emissionsPerKystvandopland.length === 0) return null

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
      <span className="text-xs text-muted-foreground">Udledningskvote</span>
      {emissionsPerKystvandopland.map((entry) => {
        const name =
          entry.kystvandNavn ??
          (entry.kystvandId !== null
            ? `Kystvandopland ${entry.kystvandId}`
            : 'Uden kystvandopland')

        return (
          <span
            key={entry.kystvandId ?? 'ukendt'}
            title={`${name}: historisk "estimeret" udledning ${formatNumber(entry.beregnetUdledningKgN)} kg N af en udledningskvote på ${formatNumber(entry.udledningskvoteKgN)} kg N`}
            className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
              entry.overholder
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                entry.overholder ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            <span className="max-w-[10rem] truncate font-medium">{name}</span>
            <span className="shrink-0 tabular-nums">
              {formatNumber(entry.beregnetUdledningKgN)} /{' '}
              {formatNumber(entry.udledningskvoteKgN)} kg N
            </span>
            <span className="sr-only">
              {entry.overholder ? 'Overholder' : 'Overskrider'}
            </span>
          </span>
        )
      })}
    </div>
  )
}
