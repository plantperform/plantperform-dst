import { useFarmHistoricalYearlySummary, useSimulationYearlySummary } from '@/api/hooks'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ROTATION_START_CALENDAR_YEAR } from '@/lib/field-domain'

type YearlyOverviewStripProps = {
  farmId: string
  // Simulation view: pass simulationId — entry.year is a relative rotation
  // position (1-8) and gets converted to a calendar year below. Historical
  // (Afgrødehistorik) view: omit it — entry.year is already the real
  // calendar year (2019-2026), used as-is.
  simulationId?: string
}

const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: digits }).format(value)

export const YearlyOverviewStrip = ({
  farmId,
  simulationId,
}: YearlyOverviewStripProps) => {
  const simulationSummary = useSimulationYearlySummary(
    simulationId ? farmId : undefined,
    simulationId,
  )
  const historicalSummary = useFarmHistoricalYearlySummary(simulationId ? undefined : farmId)
  const { data: entries } = simulationId ? simulationSummary : historicalSummary

  if (!entries || entries.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Årsoversigt</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-3">
            {entries.map((entry) => (
              <div
                key={entry.year}
                className="w-36 shrink-0 space-y-2 rounded-md border bg-muted/20 p-3"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {simulationId
                    ? ROTATION_START_CALENDAR_YEAR + entry.year - 1
                    : entry.year}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">DB2</div>
                  <div className="text-sm font-medium">
                    {formatNumber(entry.totalDb2)} kr
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Kvælstofudledning
                  </div>
                  <div className="text-sm font-medium">
                    {formatNumber(entry.totalNLoadKg, 1)} kg N
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Foderenheder
                  </div>
                  <div className="text-sm font-medium">
                    {formatNumber(entry.totalFen)} FE
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
