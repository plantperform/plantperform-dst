import { Chart } from '@tanstack/charts/react'
import { useState, type ReactNode } from 'react'

import type {
  ComparedColumn,
  OnHighlight,
} from '@/components/farm/comparison-column'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import {
  cropDistributionChart,
  cropDistributionHeight,
  db2NLoadChart,
  db2NLoadPoints,
  type Db2NLoadPoint,
} from '@/lib/comparison-charts'
import { CROP_GROUPS, type CropGroup } from '@/lib/crop-groups'
import {
  formatNumber,
  formatPerHa,
  formatWholeNumber,
  perHaUnit,
  totalsPerHa,
} from '@/lib/field-domain'
import { COMPARISON_PERIOD } from '@/lib/simulation-comparison'
import { cn } from '@/lib/utils'

const DB2_NLOAD_HEIGHT = 260
const AXIS_CAPTION_CLASS = 'text-[11px] text-muted-foreground'

const describeDb2NLoad = ({ title, db2, nLoad }: Db2NLoadPoint) =>
  `${title}\n${formatPerHa(db2, 'db2')} · ${formatPerHa(nLoad, 'nLoad')}`

type ChartCardProps = {
  title: string
  description: string
  children: ReactNode
}

const ChartCard = ({ title, description, children }: ChartCardProps) => (
  <section className="rounded-lg border bg-card px-5 pt-4 pb-4">
    <h2 className="font-display text-[17px] leading-tight">{title}</h2>
    <p className="mt-1 mb-3 text-xs text-muted-foreground">{description}</p>
    {children}
  </section>
)

type CropDistributionCardProps = {
  columns: ComparedColumn[]
  highlightedKey: string | null
}

const CropDistributionCard = ({
  columns,
  highlightedKey,
}: CropDistributionCardProps) => {
  const [hoveredGroup, setHoveredGroup] = useState<CropGroup | null>(null)
  const cropGroups = CROP_GROUPS.filter((group) =>
    columns.some((column) =>
      column.cropShares?.some((share) => share.group.id === group.id),
    ),
  )
  return (
    <ChartCard
      title="Afgrødefordeling"
      description={`Andel af arealet, gennemsnit for ${COMPARISON_PERIOD}.`}
    >
      <Chart
        definition={cropDistributionChart(
          columns.map((column) => ({
            key: column.key,
            title: column.title,
            history: column.history,
            shares: column.cropShares,
          })),
          { highlightedKey, hoveredGroup },
        )}
        height={cropDistributionHeight(columns.length)}
        ariaLabel="Afgrødefordeling for afgrødehistorikken og de valgte simuleringer"
        onFocusChange={(point) =>
          setHoveredGroup(point?.datum.group.id ?? null)
        }
      />
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {cropGroups.map((group) => (
          <li
            key={group.id}
            className={cn(
              'inline-flex items-center gap-1.5 transition-opacity duration-120',
              hoveredGroup === group.id && 'text-foreground',
              hoveredGroup !== null &&
                hoveredGroup !== group.id &&
                'opacity-40',
            )}
            onMouseEnter={() => setHoveredGroup(group.id)}
            onMouseLeave={() => setHoveredGroup(null)}
          >
            <CropGroupTile group={group} />
            {group.label}
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}

type ComparisonChartsProps = {
  columns: ComparedColumn[]
  bestBalanceKey: string | null
  highlightedKey: string | null
  onHighlight: OnHighlight
}

export const ComparisonCharts = ({
  columns,
  bestBalanceKey,
  highlightedKey,
  onHighlight,
}: ComparisonChartsProps) => {
  const [history, ...simulations] = columns
  const points = db2NLoadPoints(
    simulations.map((column) => ({
      key: column.key,
      title: column.title,
      history: column.history,
      db2: totalsPerHa(column.totals, 'db2'),
      nLoad: totalsPerHa(column.totals, 'nLoad'),
    })),
    bestBalanceKey,
    highlightedKey,
  )
  return (
    <div className="grid gap-6 @3xl:grid-cols-2">
      <ChartCard
        title="Dækningsbidrag og udledning"
        description={`Gennemsnit pr. år for ${COMPARISON_PERIOD}. Den stiplede linje er afgrødehistorikkens udledning, og til venstre for den er udledningen lavere.`}
      >
        <p className={cn(AXIS_CAPTION_CLASS, 'mb-1')}>
          Dækningsbidrag, {perHaUnit('db2')}
        </p>
        <Chart
          definition={db2NLoadChart(points, {
            historyNLoad: totalsPerHa(history.totals, 'nLoad'),
            formatDb2: formatWholeNumber,
            formatNLoad: formatNumber,
            describe: describeDb2NLoad,
          })}
          height={DB2_NLOAD_HEIGHT}
          ariaLabel="Dækningsbidrag og udledning for de valgte simuleringer"
          onFocusChange={(point) => onHighlight(point?.datum.key ?? null)}
        />
        <p className={cn(AXIS_CAPTION_CLASS, 'text-right')}>
          Udledning, {perHaUnit('nLoad')}
        </p>
      </ChartCard>
      <CropDistributionCard columns={columns} highlightedKey={highlightedKey} />
    </div>
  )
}
