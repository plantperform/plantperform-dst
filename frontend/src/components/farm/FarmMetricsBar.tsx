import type { FieldRecord } from '@/api/types'
import { FarmEmissionsPanel } from '@/components/farm/FarmEmissionsPanel'
import { formatNumber, getFieldTotals } from '@/lib/farm-totals'

type MetricProps = {
  label: string
  value: string
}

const Metric = ({ label, value }: MetricProps) => (
  <div className="flex min-w-0 items-baseline gap-1.5">
    <span className="truncate text-xs text-muted-foreground">{label}</span>
    <span className="truncate text-sm font-semibold">{value}</span>
  </div>
)

type FarmMetricsBarProps = {
  farmId: string
  fields: FieldRecord[]
}

/**
 * Nøgletal for the visning currently selected in the sidebar, on one line with
 * the udledningskvote per kystvandopland. They are folded away inside the
 * topbar until asked for: they are looked up now and then, not read on every
 * screen, so they should not cost a strip of the marker view permanently.
 *
 * There is deliberately no farm-total udledningskvote here: the bekendtgørelse
 * enforces the quota per kystvandopland, so the quota is listed per opland.
 */
export const FarmMetricsBar = ({ farmId, fields }: FarmMetricsBarProps) => {
  const totals = getFieldTotals(fields)

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-muted/20 px-3 py-2">
      <Metric label="Marker" value={String(fields.length)} />
      <Metric label="Areal" value={`${formatNumber(totals.area)} ha`} />
      <Metric label="DB2" value={`${formatNumber(totals.db2)} kr`} />
      <Metric label="Udledning" value={`${formatNumber(totals.nLoad)} kg N`} />
      <Metric
        label="Udvaskning"
        value={`${formatNumber(totals.leaching)} kg N`}
      />
      <FarmEmissionsPanel farmId={farmId} />
    </div>
  )
}
