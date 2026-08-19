import { useSimulationYearlySummary } from '@/api/hooks'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ROTATION_START_CALENDAR_YEAR } from '@/lib/field-domain'

type YearlyOverviewStripProps = {
  farmId: string
  simulationId: string
}

const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat('da-DK', { maximumFractionDigits: digits }).format(value)

export const YearlyOverviewStrip = ({
  farmId,
  simulationId,
}: YearlyOverviewStripProps) => {
  const { data: entries } = useSimulationYearlySummary(farmId, simulationId)

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
                  {ROTATION_START_CALENDAR_YEAR + entry.year - 1}
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
